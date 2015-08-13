# Ads Service Changelog

### 1.3.3: Thu Aug 13 17:23:57 EDT 2015
* [FEATURE]: Handle `application` field on campaigns: [#469](https://github.com/cinema6/cwrx/issues/469)
* [FEATURE]: Support querying for campaigns by `text` search: [#462](https://github.com/cinema6/cwrx/issues/462)
* [FEATURE]: Support querying by status(es): [#461](https://github.com/cinema6/cwrx/issues/461)
* Extra deployment steps:
    * Set `application` on all existing campaigns in staging+prod databases

### 1.3.2: Wed Jul  8 16:04:29 EDT 2015
* [FIX]: Handle Adtech error for deleting last banner in campaign: [#449](https://github.com/cinema6/cwrx/issues/449)
* [FIX]: Set `statusHistory` on campaigns: [#430](https://github.com/cinema6/cwrx/issues/423)
* Extra deployment steps:
    * Set `statusHistory` on all existing campaigns in staging+prod databases

### 1.3.1: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.3.0: Mon May 18 15:06:37 EDT 2015
* [FEATURE]: Implement Job Timeouts: [#421](https://github.com/cinema6/cwrx/pull/421)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Update chef environments so memcached is installed on ASG nodes
    * Open ports for memcached and give API servers permissions for querying AutoScaling API

### 1.2.5: Mon Apr 27 14:56:43 EDT 2015
* [FIX]: Properly set new campaigns to be exclusive: [#419](https://github.com/cinema6/cwrx/pull/419)
* Extra deployment steps: None

### 1.2.4: Thu Apr 16 10:36:19 EDT 2015
* [FIX]: Stop giving sponsored campaigns priority "High": [#414](https://github.com/cinema6/cwrx/pull/414)
* Extra deployment steps: None

### 1.2.3: Fri Mar 27 16:19:45 EDT 2015
* [FIX]: Update card banner template to pass back `sub1` Adtech var: [#409](https://github.com/cinema6/cwrx/pull/409)
* [FIX]: Remove deleted cards from a campaign's `staticCardMap`: [#411](https://github.com/cinema6/cwrx/pull/411)
* Extra deployment steps: None

### 1.2.2: Mon Mar 23 16:36:38 EDT 2015
* [FIX]: Stop setting campaign dates to one hour in future: [#407](https://github.com/cinema6/cwrx/pull/407)
* [FIX]: Set campaigns' `exclusiveType` to `EXCLUSIVE_TYPE_END_DATE`: [#407](https://github.com/cinema6/cwrx/pull/407)
* [FIX]: Campaigns are invalid if their `endDate` has changed and is in the past: [#407](https://github.com/cinema6/cwrx/pull/407)
* Extra deployment steps: Deploy new cookbook

### 1.2.1: Fri Mar 8 12:00:00 EDT 2015
* [FIX]: Make `campaignTypeId` configurable: [#401](https://github.com/cinema6/cwrx/pull/401)
* Extra deployment steps: Deploy new cookbook

### 1.2.0: Fri Feb 18 12:00:00 EST 2015
* [FEATURE]: Allow client to set `name`, `startDate` and `endDate` on C6 campaign's sub-campaigns: [#390](https://github.com/cinema6/cwrx/pull/390)
* Extra deployment steps: None

### 1.1.0: Fri Feb 17 12:00:00 EST 2015
* [FEATURE]: Add campaign and group endpoints: [#369](https://github.com/cinema6/cwrx/pull/369)
* [FIX]: Ensure site names are unique: [#369](https://github.com/cinema6/cwrx/pull/369)
* [FIX]: Get list of advertisers for each customer retrieved in `GET /api/account/customers`: [#377](https://github.com/cinema6/cwrx/pull/377)
* Extra deployment steps:
    * Deploy new ads cookbook
    * Create default advertiser and customer for content groups

### 1.0.0: Fri Jan 23 17:27:10 EST 2015
* Initial commit of ads service: [#356](https://github.com/cinema6/cwrx/pull/356)
