# Org Service Changelog

### 1.4.0: Mon Sep 28 10:33:32 EDT 2015
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
