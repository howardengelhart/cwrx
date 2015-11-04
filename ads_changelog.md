# Ads Service Changelog

* [FIX]: Properly compute cost: [#605](https://github.com/cinema6/cwrx/issues/605)
* [FEATURE]: Add schema fetching endpoint: [#592](https://github.com/cinema6/cwrx/issues/592)
* `text` query param for campaigns searches `advertiserDisplayName` as well: [#522](https://github.com/cinema6/cwrx/issues/522)
* [FEATURE]: Allow querying for campaigns with pending update requests: [#591](https://github.com/cinema6/cwrx/issues/591)
* [FEATURE]: Add campaign update request API: [#490](https://github.com/cinema6/cwrx/issues/490)
* [FEATURE]: Integrate cards + campaigns API: [#491](https://github.com/cinema6/cwrx/issues/491)
    * [BREAKING CHANGE]: `startDate`, `endDate`, `reportingId` now stored on `campaign` hash on cards
    * [BREAKING CHANGE]: `name` prop for card entries replaced with `campaign.adtechName`
* [REMOVAL]: entries in `miniReels` no longer get Adtech campaigns
* [REMOVAL]: entries in `miniReelGroups` no longer get Adtech campaigns + are no longer handled at all
* Extra deployment steps:
    * Update policies + roles to accomodate `campaignUpdates` entities
    * Setup mongo indexes for `campaignUpdates` collection
    * Coordinate with deployment of studio + selfie
    * Deploy ads cookbook version 1.0.9

### 2.0.0: Thu Oct 15 13:24:56 EDT 2015
* [FIX]: Allow null to be set for validated fields: [#570](https://github.com/cinema6/cwrx/issues/570)
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* Validate campaigns using model: [#536](https://github.com/cinema6/cwrx/issues/536)
* Set Adtech keywords using `targeting.interests` instead of `categories`: [#492](https://github.com/cinema6/cwrx/issues/492)
* Set Adtech kwlp3 keywords to '*' if no `targeting.interests`: [#492](https://github.com/cinema6/cwrx/issues/492)
* Extra deployment steps:
    * Update campaign policies with appropriate `fieldValidation`

### 1.6.0: Mon Oct  5 18:34:10 EDT 2015
* [FEATURE]: Add ability to query campaigns by list of ids: [#520](https://github.com/cinema6/cwrx/issues/520)
* [FIX]: Setting `ids` or `statuses` campaign filter params to `''` returns no campaigns: [#524](https://github.com/cinema6/cwrx/issues/524)
* Extra deployment steps: None

### 1.5.0: Tue Sep 29 13:35:21 EDT 2015
* [FIX]: Validate pagination params: [#512](https://github.com/cinema6/cwrx/issues/512)
* [FEATURE]: Add handling for `fields` param: [#454](https://github.com/cinema6/cwrx/issues/454)
* Extra deployment steps: None

### 1.4.1: Sat Sep 19 13:12:16 EDT 2015
* [FIX]: Ensure `pricingHistory` and `statusHistory` cannot be changed directly by client: [#501](https://github.com/cinema6/cwrx/pull/501)
* Extra deployment steps: None

### 1.4.0: Mon Sep 14 14:20:07 EDT 2015
* [FEATURE]: Set `pricingHistory` field on campaigns: [#495](https://github.com/cinema6/cwrx/issues/495)
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps: None

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
