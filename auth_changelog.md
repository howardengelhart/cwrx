# Auth Service Changelog

* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/issues/475)

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

### 1.3.3: Fri Oct  3 12:52:39 EDT 2014
* [FIX]: Defend against query selector injection attacks: [#303](https://github.com/cinema6/cwrx/pull/303)
* Extra deployment steps: None

### 1.3.2: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Prevent users from using forgot/reset pwd endpoints if their account is not active: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.3.1: Fri Jul 25 15:37:41 EDT 2014
* [FIX]: Force emails to lowercase: [#228](https://github.com/cinema6/cwrx/pull/228)
* Extra deployment steps: Convert all existing user's email addresses to lowercase

### 1.3.0: Thu Jul 24 10:05:01 EDT 2014
* [FEATURE]: Forgotten password retrieval: [#215](https://github.com/cinema6/cwrx/pull/215)
* Extra deployment steps: 
    * Deploy new auth cookbook to staging/production envs
    * Verify that staging/production IAM roles have proper access to SES

### 1.2.4: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.2.3: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* Extra deployment steps: None

### 1.2.2: Wed Apr 30 10:44:00 EDT 2014
* [FIX]: Use email field in place of username: [#124](https://github.com/cinema6/cwrx/pull/124)
* Extra deployment steps: None
