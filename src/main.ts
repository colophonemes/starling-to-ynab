import * as Starling from 'starling-developer-sdk'
import { DateTime } from 'luxon'
import * as Ynab from 'ynab'
import { SaveTransaction, TransactionDetail } from 'ynab'
import BigNumber from 'bignumber.js'
const { STARLING_ACCESS_TOKEN, YNAB_ACCESS_TOKEN, YNAB_ACCOUNT_ID, YNAB_BUDGET_ID } = process.env

// Default check transactions from the last fortnight, unless a START_DATE env var is present
const START_DATE = DateTime.fromISO(process.env.START_DATE).toUTC().toISO() || DateTime.local().minus({ days: 14 }).toUTC().toISO()

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

// get items from Starling Bank feed
async function getFeedItems({ accountUid, categoryUid, changesSince }: GetFeedArgs): Promise<Array<FeedItem>> {
  const feed = await starling.feedItem.getFeedItemsChangedSince({
    accountUid,
    categoryUid,
    changesSince
  })
  return feed.data.feedItems
}

// Format items from the Starling Bank feed as YNAB transactions
function formatFeedItemsAsTransactions (feedItems: Array<FeedItem>) : SaveTransaction[] {
  const transactions = feedItems
      .filter(feedItem => feedItem.amount.minorUnits > 0 && ALLOWED_PAYMENT_STATUSES.includes(feedItem.status))
      .map((feedItem: FeedItem) : SaveTransaction => ({
        // eslint-disable-next-line @typescript-eslint/camelcase
        account_id: YNAB_ACCOUNT_ID,
        date: feedItem.transactionTime,
        amount: new BigNumber(feedItem.amount.minorUnits)
                  .times(10)
                  .times(feedItem.direction === 'OUT' ? -1 : 1)
                  .toNumber(),
        // 'Transfer' is a reserved word in YNAB and payee names starting with it throw an error
        // eslint-disable-next-line @typescript-eslint/camelcase
        payee_name: feedItem.counterPartyName.replace(/^Transfer( : )?/, ''),
        // eslint-disable-next-line @typescript-eslint/camelcase
        category_id: null,
        memo: feedItem.reference,
        cleared: feedItem.status === 'SETTLED' ? SaveTransaction.ClearedEnum.Cleared : SaveTransaction.ClearedEnum.Uncleared,
        approved: true,
        // eslint-disable-next-line @typescript-eslint/camelcase
        flag_color: null,
        // eslint-disable-next-line @typescript-eslint/camelcase
        import_id: feedItem.feedItemUid,
      }))

  return transactions
}

// Get YNAB transactions that haven't been cleared yet
async function getPreviousUnclearedTransactions (budgetId: string): Promise<Ynab.TransactionDetail[]> {
  const transactions = await ynab.transactions.getTransactionsByAccount(budgetId, YNAB_ACCOUNT_ID, START_DATE)
  const filteredTransactions = transactions.data.transactions.filter(tx => tx.cleared !== TransactionDetail.ClearedEnum.Cleared)
  return filteredTransactions
}

// Filter function to get a single YNAB transaction from an array of YNAB transactions (passed to Array.filter())
const filterTransactionByImportId = importId => (tx: Ynab.TransactionDetail) : boolean => tx.import_id === importId

// given a list of previous uncleared YNAB transactions, check if any of them have cleared against the list of incoming Starling feed transactions
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

// import new Starling Feed transactions into YNAB
async function insertNewTransactions (budgetId: string, transactions: Ynab.SaveTransaction[]) : Promise<Ynab.SaveTransactionsResponseData> {
  const { data } = await ynab.transactions.createTransactions(budgetId, {transactions})
  if (data.duplicate_import_ids.length) console.log(`Skipped ${data.duplicate_import_ids.length} transactions already imported`)
  console.log(`Imported ${data.transaction_ids.length} transactions`)
  return data
}

// Update already-imported transactions that have subsequently cleared on the Starling end
async function updateExistingTransactions(budgetId: string, transactions: Ynab.UpdateTransaction[]): Promise<Ynab.SaveTransactionsResponseData> {
  const { data } = await ynab.transactions.updateTransactions(budgetId, { transactions })
  console.log(`Updated ${data.transaction_ids.length} transactions`)
  return data
}

// Main function
async function starlingToYnab (): Promise<void> {
  try {
    console.log(`Importing Starling transactions from ${START_DATE} to YNAB budget ${YNAB_BUDGET_ID}`)
    // Get data
    const account = await getPrimaryAccount()
    const feedItems = await getFeedItems({
      accountUid: account.accountUid,
      categoryUid: account.defaultCategory,
      changesSince: START_DATE
    })
    const formattedTransactions = formatFeedItemsAsTransactions(feedItems)
    // insert new transactions
    await insertNewTransactions(YNAB_BUDGET_ID, formattedTransactions)
    // update existing transactions
    const previousTransactions = await getPreviousUnclearedTransactions(YNAB_BUDGET_ID)
    const updatedTransactions = getUpdatedTransactions(previousTransactions, formattedTransactions)
    if (updatedTransactions.length) await updateExistingTransactions(YNAB_BUDGET_ID, updatedTransactions)
  } catch (err) {
    console.error(err)
  }
}

// Export for running in run.ts
export { starlingToYnab }
