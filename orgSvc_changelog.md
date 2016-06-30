# Org Service Changelog

### 1.13.0: Thu Jun 30 08:59:38 EDT 2016
* [FEATURE]: Add support for payment plan entities via
  `/api/payment-plans`: [#966](https://github.com/cinema6/cwrx/pull/966)
* Extra deployment steps:
  * Deploy `v1.4.0` of the `orgSvc` cookbook

### 1.12.0: Wed Jun 29 13:56:21 EDT 2016
* Allow setting subscription-related properties on transactions in `POST /api/payments`: [#958](https://github.com/cinema6/cwrx/issues/958)
* Allow setting transaction description as `transaction.description` on body of `POST /api/payments`: [#958](https://github.com/cinema6/cwrx/issues/958)
* [DEPRECATION]: Clients should no longer attempt to set transaction description on top-level of body of `POST /api/payments`: [#958](https://github.com/cinema6/cwrx/issues/958)
* Extra deployment steps:
    * Update deepthought + add columns to `fct.billing_transactions` schema

### 1.11.1: Tue Jun  7 12:17:17 EDT 2016
* Fail when creating duplicate payment method in production: [#878](https://github.com/cinema6/cwrx/issues/878)
* [FIX]: Handle gateway rejections when creating braintree transactions: [#924](https://github.com/cinema6/cwrx/issues/924)
* Allow setting transaction `description` on body of `POST /api/payments` request: [#921](https://github.com/cinema6/cwrx/issues/921)

### 1.11.0: Mon May 23 17:37:12 EDT 2016
* [FEATURE]: Support `freeTrial` promotions: [#905](https://github.com/cinema6/cwrx/issues/905)
* Extra deployment steps: None

### 1.10.0: Tue May  3 17:51:52 EDT 2016
* [FEATURE]: Add `GET /api/public/promotions/:id` endpoint: [#886](https://github.com/cinema6/cwrx/pull/886)
* Make `paymentPlanId` and `paymentPlanStart` forbidden fields: [#877](https://github.com/cinema6/cwrx/pull/877)
* **Extra Deployment Steps:**
  * Deploy version 1.3.0 of orgSvc cookbook
  * Give the `cwrx-app` the ability to mutate an org's `paymentPlanId`

### 1.9.0: Tue Apr 19 17:17:50 EDT 2016
* [FEATURE]: Support filtering by `ids` for `GET /api/payments`: [#868](https://github.com/cinema6/cwrx/pull/868)
* Extra deployment steps: None

### 1.8.1: Tue Apr 12 17:42:09 EDT 2016
* [FIX]: Update schema for `org.promotions`: [#864](https://github.com/cinema6/cwrx/pull/864)
* Extra deployment steps: None

### 1.8.0: Mon Apr 11 12:31:33 EDT 2016
* [FIX]: Support `POST /api/payment` in addition to `POST /api/payments`: [#861](https://github.com/cinema6/cwrx/pull/861)
* [FEATURE]: Add endpoints for promotion entities: [#841](https://github.com/cinema6/cwrx/issues/841)
* [FEATURE]: Publish `paymentMade` event upon successful `POST /api/payments` so watchman can send receipt: [#845](https://github.com/cinema6/cwrx/issues/845)
* [FEATURE]: Allow apps with `makePaymentForAny` to make payments + paymentMethods for any org: [#837](https://github.com/cinema6/cwrx/issues/837)
* [FEATURE]: Allow apps to get payments + paymentMethods for orgs: [#837](https://github.com/cinema6/cwrx/issues/837)
* [FIX]: Make minimum amount for `POST /api/payments` configurable: [#843](https://github.com/cinema6/cwrx/issues/843)
* [FEATURE]: Support `hasPaymentPlan` query parameter on
  `GET /api/account/orgs` to find all orgs with a `paymentPlanId`:
  [#838](https://github.com/cinema6/cwrx/pull/838/files)
* Extra deployment steps:
    * Ensure watchman app has necessary permissions to `POST /api/payments`
    * Ensure watchman app has `permissions.orgs.edit === 'all'` and `fieldValidation.orgs.promotions.__allowed === true`
    * Update nightly_build and orgSvc jobs to create + destroy watchman streams
    * Deploy version 1.2.0 of orgSvc cookbook

### 1.7.0: Wed Mar 30 14:41:02 EDT 2016
* [FEATURE]: Add `POST /api/payment` endpoint: [#811](https://github.com/cinema6/cwrx/issues/811)
* Allow deleting payment methods regardless of account's campaigns: [#813](https://github.com/cinema6/cwrx/issues/813)
* Remove campaign id + name from payment responses: [#812](https://github.com/cinema6/cwrx/issues/812)
* Extra deployment steps: None

### 1.6.2: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 1.6.1: Mon Mar 14 11:43:43 EDT 2016
* [FIX]: Compress job results written to memcached: [#819](https://github.com/cinema6/cwrx/issues/819)
* Extra deployment steps: None

### 1.6.0: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* [FEATURE]: Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)
* Extra deployment steps: None

### 1.5.2: Mon Feb  8 13:39:09 EST 2016
* Do not allow deleting paymentMethods for completed/outOfBudget campaigns: [#784](https://github.com/cinema6/cwrx/issues/784)
* Extra deployment steps: None

### 1.5.1: Fri Jan 29 15:28:10 EST 2016
* Treat 'completed' campaign status like 'expired' for deleting orgs: [#766](https://github.com/cinema6/cwrx/issues/766)
* Treat 'completed' campaign status like 'expired' for deleting paymentMethods: [#766](https://github.com/cinema6/cwrx/issues/766)
* Extra deployment steps: None

### 1.5.0: Thu Jan 14 17:49:00 EST 2016
* [FEATURE]: Add endpoints for new `referralCode` entities: [#737](https://github.com/cinema6/cwrx/issues/737)
* Extra deployment steps:
    * Add policies for managing `referralCodes`
    * Update `policyAdmin` policy to allow configuring `permissions` and `fieldValidation` for `referralCodes`
    * Setup mongo indexes for `referralCodes` collection
    * Deploy orgSvc cookbook version 1.1.0

### 1.4.3: Mon Jan 11 12:36:22 EST 2016
* [FIX]: Cease recursive validation if a field is unchanged: [#728](https://github.com/cinema6/cwrx/pull/728)
* [FIX]: Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)

### 1.4.2: Fri Nov 13 11:03:21 EST 2015
* Set extra identifying info on braintree customers: [#627](https://github.com/cinema6/cwrx/pull/627)
* Allow `null` to be set for validated fields: [#573](https://github.com/cinema6/cwrx/pull/573)
* Extra deployment steps: None

### 1.4.1: Thu Oct 15 13:24:56 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* [FIX]: Setting `ids` org filter param to `''` returns no orgs: [#524](https://github.com/cinema6/cwrx/issues/524)
* Extra deployment steps: None

### 1.4.0: Mon Sep 28 10:33:32 EDT 2015
* [FIX]: Validate pagination params: [#512](https://github.com/cinema6/cwrx/issues/512)
* [FEATURE]: Add handling for `fields` param: [#454](https://github.com/cinema6/cwrx/issues/454)
* [FEATURE]: Add payment endpoints: [#477](https://github.com/cinema6/cwrx/issues/477)
* [FEATURE]: Add job caching to all orgSvc endpoints: [#506](https://github.com/cinema6/cwrx/pull/506)
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps:
    * Deploy updated orgSvc cookbook
    * For deploying to production: setup production braintree account

### 1.3.2: Mon Jul 20 17:22:58 EDT 2015
* [REFACTOR]: Re-write to use CrudSvc: [#458](https://github.com/cinema6/cwrx/pull/458)
* Multi-get endpoint now returns 200: [] when no users are found instead of a 404: [#337](https://github.com/cinema6/cwrx/issues/337)

### 1.3.1: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.3.0: Wed Feb  4 17:16:46 EST 2015
* [FEATURE]: Add ability to query by list of ids: [#365](https://github.com/cinema6/cwrx/pull/365)
* Extra deployment steps: None

### 1.2.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.1.2: Wed Sep 10 11:07:04 EDT 2014
* [FIX]: Add permission for editing orgs' `adConfig`: [#272](https://github.com/cinema6/cwrx/pull/272)
* [FIX]: Properly compare new `adConfig` with existing `adConfig` on edit: [#275](https://github.com/cinema6/cwrx/pull/275)
* Extra deployment steps: Update existing C6 admins with `editAdConfig` permission

### 1.1.1: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.1.0: Mon Aug 18 14:31:18 EDT 2014
* [FEATURE]: Send Content-Range header when paginating orgs: [#258](https://github.com/cinema6/cwrx/pull/258)
* Extra deployment steps: None

### 1.0.4: Mon Aug  4 12:40:36 EDT 2014
* [FIX]: Fix hardcoding new orgs' config: [#242](https://github.com/cinema6/cwrx/pull/242)
* Extra deployment steps: None

### 1.0.3: Wed Jul 30 13:51:13 EDT 2014
* [FIX]: Allow changing name of orgs: [#237](https://github.com/cinema6/cwrx/pull/237)
* [FIX]: Prevent deleting org with active users: [#239](https://github.com/cinema6/cwrx/pull/239)
* Extra deployment steps: None

### 1.0.2: Thu Jul 24 10:05:01 EDT 2014
* [FIX]: Setup default config object on new orgs: [#224](https://github.com/cinema6/cwrx/pull/224)
* Extra deployment steps: None

### 1.0.1: Fri Jun 13 09:54:09 EDT 2014
* [FIX]: Set Org Service to use proper waterfall properties: [#196](https://github.com/cinema6/cwrx/pull/196)
* Extra deployment steps: None

### 1.0.0: Thu Jun 12 15:13:20 EDT 2014
* Initial commit of org service: [#192](https://github.com/cinema6/cwrx/pull/192)
