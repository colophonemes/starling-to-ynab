# Starling to YNAB

Auto-import your [Starling Bank](https://www.starlingbank.com/) transactions into your [YNAB](https://www.youneedabudget.com/) account.

Can be deployed as a Google Cloud Function to run automatically.

## Features
- Auto import all transactions from Starling to YNAB
- Updates cleared transactions with real transaction value to avoid currency conversion discrepancies
- Easy deploy to Google Cloud functions

## Motivation / Prior Art

Other solutions for this exist, including `[fintech-to-ynab](https://github.com/syncforynab/fintech-to-ynab)`, but I had problems with outdated dependencies, and it doesn't update transactions once they've cleared (which can lead to incorrect amounts due to exchange rate differences between the time a transaction is created, and when it clears). The authors of `fintech-to-ynab` also have a commercial product, [Sync for YNAB](https://syncforynab.com/), but it costs £3.99/month. Plus, I wanted a solution that was simple to deploy to a cloud function.

## Setup

Setup your environment

```sh
yarn init:env # Create .env.yml
```

Set environment variables in `.env.yml`:

- `STARLING_ACCESS_TOKEN`: Personal access token from your [Starling Developer account](https://developer.starlingbank.com/) (Create an access token with all `read` scopes from the *Personal Access* tab).
- `YNAB_ACCESS_TOKEN`: Access token from your [YNAB account](https://app.youneedabudget.com/settings/developer) (*Account Settings* -> *Developer Settings* -> *New Token*)
- `YNAB_BUDGET_ID`: UUID for your YNAB budget (navigate to your budget in YNAB, get ID from URL: `https://app.youneedabudget.com/<YNAB_BUDGET_ID>`)
- `YNAB_ACCOUNT_ID`: UUID for your Starling Bank account as set up in YNAB (navigate to your Starling account in YNAB, get ID from URL: `https://app.youneedabudget.com/<YNAB_BUDGET_ID>/accounts<YNAB_ACCOUNT_ID>`)

## Google Cloud Deploy

```
yarn deploy
```

This creates a project called `starling-to-ynab`,

Project/function names can be customised by editing the `config` key in `package.json`.

Based on [node-typescript-boilerplate](https://github.com/jsynowiec/node-typescript-boilerplate)
