# Auth Service Changelog

### 2.0.2 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 2.0.1: Tue Jun 21 10:37:56 EDT 2016
* [FIX]: Allow users with `status === 'new'` to user forgot+reset password endpoints: [#918](https://github.com/cinema6/cwrx/issues/918)
* Extra deployment steps: None

### 2.0.0: Mon May 16 09:04:45 EDT 2016
* [REMOVAL]: Endpoints will no longer send emails: [#887](https://github.com/cinema6/cwrx/issues/887)
* Ensure `target` is set properly on all watchman notifications: [#887](https://github.com/cinema6/cwrx/issues/887)
* Extra deployment steps:
    * Deploy auth cookbook 1.3.10
    * Ensure Cloudfront is forwarding `host` header

### 1.7.0: Mon Apr 11 12:31:33 EDT 2016
* Produce certain auth events to a Kinesis stream
* Extra deployment steps:
  * Deploy auth cookbook 1.3.9 to staging/production envs
  * Deploy watchman 0.2.0
  * Disable emailing in the auth environment

### 1.6.2: Mon Mar 21 16:37:19 EDT 2016
* Add flag to toggle email notifications: [#825](https://github.com/cinema6/cwrx/pull/825)
* Extra deployment steps:
    * Deploy auth cookbook 1.3.8 to staging/production envs

### 1.6.1: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 1.6.0: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* [FEATURE]: Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)
* [FIX]: Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)
* Extra deployment steps: None

### 1.5.3: Tue Nov 24 17:00:03 EST 2015
* [FIX]: Do not fail successful login if cache is down: [#661](https://github.com/cinema6/cwrx/issues/661)
* Extra deployment steps: None

### 1.5.2: Fri Nov 20 15:48:37 EST 2015
* [FIX]: Fix spacing on logo in email templates: [#645](https://github.com/cinema6/cwrx/issues/645)
* Extra deployment steps: None

### 1.5.1: Tue Nov 10 11:25:27 EST 2015
* [FIX]: Fix for an issue where failed login attempts were kept track of for longer than they should have been: [#624](https://github.com/cinema6/cwrx/issues/624)
* Integrate designed email templates: [#553](https://github.com/cinema6/cwrx/issues/553)
* Extra deployment steps:
    * Deploy auth cookbook 1.3.5 to staging/production envs

### 1.5.0: Thu Nov  5 12:13:27 EST 2015
* [FEATURE]: Email user on repeated failed login attempts to their account [#485](https://github.com/cinema6/cwrx/issues/485)
* Expire login sessions after 30 minutes [#487](https://github.com/cinema6/cwrx/issues/487)
* Extra deployment steps:
    * Deploy auth cookbook 1.3.4 to staging/production envs
    * Update test environments to run memcached and monitor

### 1.4.4: Wed Oct 14 18:47:35 EDT 2015
* [FIX]: Properly handle forgot password targets with query strings: [#562](https://github.com/cinema6/cwrx/pull/562)
* Extra deployment steps: None

### 1.4.3: Tue Oct 13 14:35:41 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* Allow users with a status of new to login
* [FEATURE]: Delete other user sessions on successful password reset: [#486](https://github.com/cinema6/cwrx/issues/486)
* Extra deployment steps: None

### 1.4.2: Mon Sep 28 10:33:32 EDT 2015
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps: None

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
