# Starling to YNAB

Auto-import your [Starling Bank](https://www.starlingbank.com/) transactions into your [YNAB](https://www.youneedabudget.com/) account.

Can be deployed as a Google Cloud Function to run automatically.

Based on [node-typescript-boilerplate](https://github.com/jsynowiec/node-typescript-boilerplate)

## Features
- Auto import all transactions from Starling to YNAB
- Updates cleared transactions with real transaction value to avoid currency conversion discrepancies
- Easy deploy to Google Cloud functions

## Motivation / Prior Art

Other solutions for this exist, including `[fintech-to-ynab](https://github.com/syncforynab/fintech-to-ynab)`, but I had problems with outdated dependencies, and it doesn't update transactions once they've cleared (which can lead to incorrect amounts due to exchange rate differences between the time a transaction is created, and when it clears). The authors of `fintech-to-ynab` also have a commercial product, [Sync for YNAB](https://syncforynab.com/), but it costs £3.99/month. Plus, I wanted a solution that was simple to deploy to a cloud function.

## Setup

```sh
yarn install # install dependencies
yarn init:env # Create .env.yml
```

Set environment variables in `.env.yml`:

- `STARLING_ACCESS_TOKEN`: Personal access token from your [Starling Developer account](https://developer.starlingbank.com/) (Create an access token with all `read` scopes from the *Personal Access* tab).
- `YNAB_ACCESS_TOKEN`: Access token from your [YNAB account](https://app.youneedabudget.com/settings/developer) (*Account Settings* -> *Developer Settings* -> *New Token*)
- `YNAB_BUDGET_ID`: UUID for your YNAB budget (navigate to your budget in YNAB, get ID from URL: `https://app.youneedabudget.com/<YNAB_BUDGET_ID>`)
- `YNAB_ACCOUNT_ID`: UUID for your Starling Bank account as set up in YNAB (navigate to your Starling account in YNAB, get ID from URL: `https://app.youneedabudget.com/<YNAB_BUDGET_ID>/accounts<YNAB_ACCOUNT_ID>`)

## Usage

```sh
yarn start
```

By default the script imports transactions from the last two weeks. If you want to import a different date range (e.g. importing transactions from the date you opened the account), you can supply a `START_DATE` environment variable as an ISO-formatted date string, and the script will import from that date:

```sh
START_DATE=2019-01-01 yarn start # import all transactions from 2019-01-01
```

## Google Cloud Deploy

Ensure you have the `gcloud` CLI tool [installed and initialised with your Google Developer account credentials](https://cloud.google.com/sdk/docs/downloads-interactive).

Start by creating a new project with ID `starling-to-ynab` (if you used a different name, you'll have to edit the value of `config.gcp_project` in `package.json`).

### Deploy the cloud function
```
yarn deploy
```

### Create a scheduled task to trigger the function

In your GCP project, create a new `Cloud Scheduler` job, with the following attributes:

- ID can be anything you want, I used `starling-to-ynab-default-trigger`
- Frequency: `*/10 * * * *` ([every 10 minutes](https://crontab.guru/#*/10_*_*_*_*))
- Timezone: _Your timezone_ (this doesn't really matter)
- Target: `Pub/Sub`
- Topic: `starling-to-ynab-default`
- Payload: `{}`

Test the function by clicking `Run Now`. Return to the Cloud Function dashboard, click on the `starlingToYnab` function, and click `View Logs`. You should see output like the following:

```
Importing Starling transactions from 2020-05-10T12:55:19.969Z to YNAB budget <YOUR_YNAB_BUDGET_ID>
Skipped 26 transactions already imported
Imported 0 transactions
```

All set! New transactions should now be imported/updated automatically every 10 minutes.
