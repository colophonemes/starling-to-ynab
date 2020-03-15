import * as Starling from 'starling-developer-sdk'
import { DateTime } from 'luxon'
import * as Ynab from 'ynab'
import { BudgetSummary, SaveTransaction, SaveTransactionsWrapper, TransactionResponse, SaveTransactionWrapper, TransactionDetail } from 'ynab'
import BigNumber from 'bignumber.js'
const { STARLING_ACCESS_TOKEN, YNAB_ACCESS_TOKEN, YNAB_ACCOUNT_ID } = process.env

const START_DATE = DateTime.local().minus({ days: 14 }).toUTC().toISO()

const ALLOWED_PAYMENT_STATUSES = ['UPCOMING', 'PENDING', 'SETTLED']

const starling = new Starling({
  accessToken: STARLING_ACCESS_TOKEN
})

const ynab = new Ynab.API(YNAB_ACCESS_TOKEN)

interface StarlingAccount {
  accountUid: string
  defaultCategory: string
  currency: string,
  createdAt: string
}

async function getPrimaryAccount (): Promise<StarlingAccount> {
  const accounts = await starling.account.getAccounts()
  const account = accounts.data.accounts[0]
  return account
}

interface GetFeedArgs {
  accountUid: string
  categoryUid: string
  changesSince: string
}

interface StarlingAmount {
  currency: string
  minorUnits: number
}

interface FeedItem {
  feedItemUid: string
  categoryUid: string
  amount: StarlingAmount
  sourceAmount: StarlingAmount
  direction: string
  updatedAt: string
  transactionTime: string
  settlementTime: string
  source: string
  sourceSubType: string
  status: string
  counterPartyType: string
  counterPartyUid: string
  counterPartyName: string
  counterPartySubEntityUid: string
  reference: string
  country: string
  spendingCategory: string
}

async function getFeedItems({ accountUid, categoryUid, changesSince }: GetFeedArgs): Promise<Array<FeedItem>> {
  const feed = await starling.feedItem.getFeedItemsChangedSince({
    accountUid,
    categoryUid,
    changesSince
  })
  return feed.data.feedItems
}

async function getBudget (): Promise<BudgetSummary> {
  const { data: { budgets } } = await ynab.budgets.getBudgets()
  return budgets[0]
}

function formatFeedItemsAsTransactions (feedItems: Array<FeedItem>) : SaveTransaction[] {
  const transactions = feedItems
      .filter(feedItem => feedItem.amount.minorUnits > 0 && ALLOWED_PAYMENT_STATUSES.includes(feedItem.status))
      .map((feedItem: FeedItem) : SaveTransaction => ({
        account_id: YNAB_ACCOUNT_ID,
        date: feedItem.transactionTime,
        amount: new BigNumber(feedItem.amount.minorUnits)
                  .times(10)
                  .times(feedItem.direction === 'OUT' ? -1 : 1)
                  .toNumber(),
        payee_name: feedItem.counterPartyName,
        category_id: null,
        memo: feedItem.reference,
        cleared: feedItem.status === 'SETTLED' ? SaveTransaction.ClearedEnum.Cleared : SaveTransaction.ClearedEnum.Uncleared,
        approved: true,
        flag_color: null,
        import_id: feedItem.feedItemUid,
      }))

  return transactions
}


async function getPreviousUnclearedTransactions (budgetId: string): Promise<Ynab.TransactionDetail[]> {
  const transactions = await ynab.transactions.getTransactionsByAccount(budgetId, YNAB_ACCOUNT_ID, START_DATE)
  const filteredTransactions = transactions.data.transactions.filter(tx => tx.cleared !== TransactionDetail.ClearedEnum.Cleared)
  return filteredTransactions
}

const filterTransactionByImportId = importId => tx => tx.import_id === importId

function getUpdatedTransactions(previousTransactions: Ynab.TransactionDetail[], formattedTransactions: Ynab.SaveTransaction[]): Ynab.UpdateTransaction[] {
  // get a list of all the cleared transactions we're about to import
  const transactionImportIds = formattedTransactions
    .filter(tx => tx.cleared === TransactionDetail.ClearedEnum.Cleared)
    .map(tx => tx.import_id)
  const updatedTransactions = []
  for (const importId of transactionImportIds) {
    // look for this import id in our previous transaction list
    const filterFn = filterTransactionByImportId(importId)
    const previousTransaction = previousTransactions.filter(filterFn)[0]
    if (!previousTransaction) continue
    const formattedTransaction = formattedTransactions.filter(filterFn)[0]
    // update the transaction details
    const updatedTransaction = {
      ...previousTransaction,
      amount: formattedTransaction.amount,
      cleared: SaveTransaction.ClearedEnum.Cleared
    }
    updatedTransactions.push(updatedTransaction)
  }
  return updatedTransactions
}

async function insertNewTransactions (budgetId: string, transactions: Ynab.SaveTransaction[]) : Promise<Ynab.SaveTransactionsResponseData> {
  const { data } = await ynab.transactions.createTransactions(budgetId, {transactions})
  if (data.duplicate_import_ids.length) console.log(`Skipped ${data.duplicate_import_ids.length} transactions already imported`)
  console.log(`Imported ${data.transaction_ids.length} transactions`)
  return data
}

async function updateExistingTransactions(budgetId: string, transactions: Ynab.UpdateTransaction[]): Promise<Ynab.SaveTransactionsResponseData> {
  const { data } = await ynab.transactions.updateTransactions(budgetId, { transactions })
  console.log(data)
  console.log(`Updated ${data.transaction_ids.length} transactions`)
  return data
}

async function starlingToYnab (): Promise<void> {
  try {
    console.log(START_DATE)
    const account = await getPrimaryAccount()
    const feedItems = await getFeedItems({
      accountUid: account.accountUid,
      categoryUid: account.defaultCategory,
      changesSince: START_DATE
    })
    const budget = await getBudget()
    const formattedTransactions = formatFeedItemsAsTransactions(feedItems)
    // insert new transactions
    await insertNewTransactions(budget.id, formattedTransactions)
    // update existing transactions
    const previousTransactions = await getPreviousUnclearedTransactions(budget.id)
    const updatedTransactions = getUpdatedTransactions(previousTransactions, formattedTransactions)
    if (updatedTransactions.length) await updateExistingTransactions(budget.id, updatedTransactions)
  } catch (err) {
    console.error(err)
  }
}

export { starlingToYnab }
