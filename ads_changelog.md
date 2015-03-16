# Ads Service Changelog

### 1.2.1:
* [FIX]: Make `campaignTypeId` configurable: [#401](https://github.com/cinema6/cwrx/pull/401)
* Extra deployment steps: Deploy new cookbook

### 1.2.0: 
* [FEATURE]: Allow client to set `name`, `startDate` and `endDate` on C6 campaign's sub-campaigns: [#390](https://github.com/cinema6/cwrx/pull/390)
* Extra deployment steps: None

### 1.1.0: 
* [FEATURE]: Add campaign and group endpoints: [#369](https://github.com/cinema6/cwrx/pull/369)
* [FIX]: Ensure site names are unique: [#369](https://github.com/cinema6/cwrx/pull/369)
* [FIX]: Get list of advertisers for each customer retrieved in `GET /api/account/customers`: [#377](https://github.com/cinema6/cwrx/pull/377)
* Extra deployment steps:
    * Deploy new ads cookbook
    * Create default advertiser and customer for content groups

### 1.0.0: Fri Jan 23 17:27:10 EST 2015
* Initial commit of ads service: [#356](https://github.com/cinema6/cwrx/pull/356)
