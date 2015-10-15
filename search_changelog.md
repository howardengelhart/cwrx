# Search Service Changelog

### 1.3.7: Thu Oct 15 13:24:56 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* Extra deployment steps: None

### 1.3.6: Mon Sep 28 10:33:32 EDT 2015
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps: None

### 1.3.5: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.3.4: Mon Mar  9 10:29:12 EDT 2015
* [FIX]: Handle long vimeo durations: [#391](https://github.com/cinema6/cwrx/pull/391)
* Extra deployment steps: None

### 1.3.3: Mon Mar  2 12:21:15 EST 2015
* [FIX]: Handle `m.youtube.com` links: [#387](https://github.com/cinema6/cwrx/pull/387)
* Extra deployment steps: None

### 1.3.2: Fri Jan 30 11:41:29 EST 2015
* [FIX]: Support all of vimeo's duration formats: [#361](https://github.com/cinema6/cwrx/pull/361)
* Extra deployment steps: None

### 1.3.1: Wed Jan 21 11:54:53 EST 2015
* [FIX]: Support "# minutes" duration formats: [#357](https://github.com/cinema6/cwrx/pull/357)
* Extra deployment steps: None

### 1.3.0: Mon Dec  8 13:28:31 EST 2014
* [FEATURE]: Add support for Rumble: [#343](https://github.com/cinema6/cwrx/pull/343)
* Extra deployment steps: None

### 1.2.0: Tue Nov 18 14:31:36 EST 2014
* [FEATURE]: Add support for AOL and Yahoo videos: [#329](https://github.com/cinema6/cwrx/pull/329)
* Extra deployment steps: Deploy new search service cookbook

### 1.1.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.0.4: Mon Sep 22 12:41:39 EDT 2014
* [FIX]: Prevent client from seeing or querying for more than 100 results: [#289](https://github.com/cinema6/cwrx/pull/289)
* Extra deployment steps: None

### 1.0.3: Thu Sep 11 15:30:07 EDT 2014
* [FIX]: Handle empty responses from Google: [#278](https://github.com/cinema6/cwrx/pull/278)
* Extra deployment steps: None

### 1.0.2: Tue Sep  2 11:10:04 EDT 2014
* [FIX]: Retry requests to Google: [#266](https://github.com/cinema6/cwrx/pull/266)
* Extra deployment steps: None

### 1.0.1: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.0.0: Mon Aug 25 14:06:18 EDT 2014
* Initial commit of search service: [#260](https://github.com/cinema6/cwrx/pull/260)
