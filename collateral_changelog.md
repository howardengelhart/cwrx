# Collateral Service Changelog

### 1.4.3: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.4.2: Thu Nov 20 16:33:11 EST 2014
* [FIX]: Don't switch protocol for yahoo img urls: [#331](https://github.com/cinema6/cwrx/pull/331)
* Extra deployment steps: None

### 1.4.1: Wed Nov 12 14:47:10 EST 2014
* [FIX]: Default thumbnail urls to http to fix issue with vimeo + dailymotion: [#325](https://github.com/cinema6/cwrx/pull/325)
* Extra deployment steps: None

### 1.4.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.3.3: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.3.2: Mon Jun 23 08:03:00 EDT 2014
* [FIX]: splash templates updated to prevent letterboxing of image: [#205](https://github.com/cinema6/cwrx/pull/205)
* [FIX]: added mock for os.tmpdir to collateral unit tests to handle diffs between OSX and Linux return values
* Extra deployment steps: None

### 1.3.1: Wed Jun 18 17:47:23 EDT 2014
* [FIX]: Allow CacheControl to be set to 0: [#203](https://github.com/cinema6/cwrx/pull/203)
* Extra deployment steps: None

### 1.3.0: Wed Jun 18 13:08:35 EDT 2014
* [FEATURE]: Add setHeaders method: [#200](https://github.com/cinema6/cwrx/pull/200)
* [FIX]: Cache splash images: [#199](https://github.com/cinema6/cwrx/pull/199)
* Extra deployment steps: Deploy collateral cookbook [changes](https://bitbucket.org/cinema6/collateral/pull-request/6/added-extra-options-for-caching/diff)

### 1.2.5: Wed Jun 11 16:15:13 EDT 2014
* [FEATURE]: Add templates for 5 thumbnails: [#189](https://github.com/cinema6/cwrx/pull/189)
* [FEATURE]: Allow service to choose 5-thumb templates: [#190](https://github.com/cinema6/cwrx/pull/190)
* Extra deployment steps: None

### 1.2.4: Mon Jun  9 17:49:43 EDT 2014
* [FIX]: Rename 6-4 templates to 3-2: [#186](https://github.com/cinema6/cwrx/pull/186)
* [FIX]: Handle protocol-relative urls properly: [#187](https://github.com/cinema6/cwrx/pull/187)
* Extra deployment steps: None

### 1.2.3: Fri Jun  6 15:15:26 EDT 2014
* [FIX]: Change splash generation request body: [#179](https://github.com/cinema6/cwrx/pull/179)
* [FIX]: Set Cache-Control for all files: [#179](https://github.com/cinema6/cwrx/pull/179)
* Extra deployment steps: None

### 1.2.2: Thu May 29 04:11:00 EDT 2014
* [FIX]: Splash templates renamed: [#169](https://github.com/cinema6/cwrx/pull/169)
* Extra deployment steps: None

### 1.2.1: Thu May 29 11:24:53 EDT 2014
* [FIX]: Explicitly set Content-Type for uploaded images, but not extensions: [#166](https://github.com/cinema6/cwrx/pull/166)
* Extra deployment steps: None

### 1.2.0: Fri May 23 10:35:35 EDT 2014
* [FEATURE]: Add endpoint for splash generation: [#160](https://github.com/cinema6/cwrx/pull/160)
* Extra deployment steps:
    * Deploy collateral cookbook v0.2.0 to all environments

### 1.1.0: Tue May 20 11:55:10 EDT 2014
* [FEATURE]: Add endpoint for uploading to experience: [#157](https://github.com/cinema6/cwrx/pull/157)
* Extra deployment steps: None

### 1.0.1: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.0.0: Mon May  5 14:36:24 EDT 2014
* First deployment: [#127](https://github.com/cinema6/cwrx/pull/127)
* Extra deployment steps:
    * Push up update to staging environment to include collateral service
