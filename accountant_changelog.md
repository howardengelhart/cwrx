# Accountant Service Changelog

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

