# Accountant Service Changelog

### 1.6.2 Mon Aug  1 10:02:35 EDT 2016
* Transition to the updated method of signing authenticated app requests: [#983](https://github.com/cinema6/cwrx/pull/983)

### 1.6.1 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 1.6.0: Tue Jul 19 12:27:19 EDT 2016
* [FEATURE]: Add `GET /api/transactions/showcase/current-payment`

### 1.5.0: Wed Jun 29 13:56:21 EDT 2016
* Allow setting subscription-related properties on transactions: [#958](https://github.com/cinema6/cwrx/issues/958)
* Extra deployment steps:
    * Update deepthought + add columns to `fct.billing_transactions` schema

### 1.4.0: Tue Jun 14 15:28:12 EDT 2016
* [FEATURE]: Add `GET /api/accounting/balances` endpoint for fetching multiple orgs' balances: [#938](https://github.com/cinema6/cwrx/issues/938)
* [FIX]: Fetch orgs from mongo, not orgSvc, to ease load issues: [#938](https://github.com/cinema6/cwrx/issues/938)

### 1.3.1: Tue Jun  7 12:17:17 EDT 2016
* Set max length on `description`: [#923](https://github.com/cinema6/cwrx/pull/923)

### 1.3.0: Mon May 16 09:02:34 EDT 2016
* Publish a record to kinesis when a transaction is created: [#892](https://github.com/cinema6/cwrx/pull/892)

### 1.2.0: Wed Apr 27 14:01:19 EDT 2016
* [FEATURE]: Add `POST /api/accounting/credit-check` endpoint: [#872](https://github.com/cinema6/cwrx/issues/872)
* Extra deployment steps: None

### 1.1.0: Mon Apr 18 17:05:16 EDT 2016
* [FEATURE]: Add `GET /api/transactions` endpoint: [#833](https://github.com/cinema6/cwrx/issues/833)
* [FEATURE]: Return `totalSpend` in body of `GET /api/accounting/balance` request: [#867](https://github.com/cinema6/cwrx/issues/867)
* Extra deployment steps:
    * Ensure users have `permissions.transactions.read === 'org'`

### 1.0.1: Mon Apr 11 12:31:33 EDT 2016
* [FIX]: Fix calculation of `outstandingBudget` to accommodate pending campaigns + updates: [#849](https://github.com/cinema6/cwrx/issues/849)
* [FIX]: Allow passing custom `transactionTS` when creating transaction: [#860](https://github.com/cinema6/cwrx/pull/860)
* Extra deployment steps: None

### 1.0.0: Wed Mar 30 14:41:02 EDT 2016
* Initial commit of accountant service: [#816](https://github.com/cinema6/cwrx/issues/816)
* Extra deployment steps: [#826](https://github.com/cinema6/cwrx/issues/826)
