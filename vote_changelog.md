# Vote Service Changelog

* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)

### 1.4.1: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.4.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.3.6: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.3.5: Thu Aug 14 17:03:16 EDT 2014
* [FIX]: Periodic sync shouldn't query mongo if no elections to sync: [#256](https://github.com/cinema6/cwrx/pull/256)
* Extra deployment steps: None

### 1.3.4: Mon Jun  9 12:09:23 EDT 2014
* [FIX]: Support Array ballot items; prevent modifying existing ballot items through PUT: [#182](https://github.com/cinema6/cwrx/pull/182)
* [FIX]: Prevent creating empty elections; prevent adding items through voting: [#174](https://github.com/cinema6/cwrx/pull/174)
* Extra deployment steps: None

### 1.3.3: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.3.2: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* Extra deployment steps: None
