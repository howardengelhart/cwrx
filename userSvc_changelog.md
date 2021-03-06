# User Service Changelog

### 4.1.3 Mon Aug  1 10:02:35 EDT 2016
* Transition to the updated method of signing authenticated app requests: [#983](https://github.com/cinema6/cwrx/pull/983)

### 4.1.2 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 4.1.1: Tue Jun 21 10:37:56 EDT 2016
* Require `firstName` and `lastName` on signup: [#945](https://github.com/cinema6/cwrx/issues/945)
* Extra deployment steps: None

### 4.1.0: Mon Jun 13 14:36:09 EDT 2016
* Produce the emailChanged event only once: [#940](https://github.com/cinema6/cwrx/pull/940)

### 4.0.1: Thu Jun  9 11:47:12 EDT 2016
* Produce Hubspot tracking cookie to watchman when an account is created: [#932](https://github.com/cinema6/cwrx/pull/932/files)

### 4.0.0: Mon May 16 09:07:44 EDT 2016
* [REMOVAL]: Users module will no longer send emails: [#887](https://github.com/cinema6/cwrx/issues/887)
* Ensure `target` is set properly on all watchman notifications: [#887](https://github.com/cinema6/cwrx/issues/887)
* Use `target` to give signup users correct roles/policies: [#887](https://github.com/cinema6/cwrx/issues/887)
* Extra deployment steps:
    * Deploy userSvc cookbook 1.4.4
    * Ensure Cloudfront is forwarding `host` header
    * Create policies for new showcase users + update config for `newUserPermissions`

### 3.4.0: Mon Apr 11 12:31:33 EDT 2016
* Produce certain user account events to a Kinesis stream
* [FEATURE]: Add ability to give orgs a `paymentPlanId` when they are
  created via `POST /api/account/users/confirm/:id`: [#838](https://github.com/cinema6/cwrx/pull/838/files)
* Extra deployment steps:
  * Deploy userSvc cookbook 1.4.3 to staging/production envs
  * Deploy watchman 0.2.0
  * Disable emailing in the userSvc environment

### 3.3.0: Wed Mar 16 16:07:41 EDT 2016
* Add flag to toggle email notifications: [#825](https://github.com/cinema6/cwrx/pull/825)
* [FEATURE]: Support app authentication: [#823](https://github.com/cinema6/cwrx/pull/823)
* [FIX]: Stop jamming user id into new advertisers on signup: [#806](https://github.com/cinema6/cwrx/issues/806)
* Extra deployment steps: None
    * Deploy userSvc cookbook 1.4.2 to staging/production envs

### 3.2.2: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 3.2.1: Mon Mar 14 11:43:43 EDT 2016
* [FIX]: Compress job results written to memcached: [#819](https://github.com/cinema6/cwrx/issues/819)
* Extra deployment steps: None

### 3.2.0: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* [FEATURE]: Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)
* Update `/confirm` endpoint to use app authentication instead of sixxy user: [#799](https://github.com/cinema6/cwrx/pull/799)
* Extra deployment steps:
    * Deploy c6env cookbook version 2.16.0
    * Deploy userSvc cookbook version 1.4.0
    * Create cwrx application in db

### 3.1.0: Thu Jan 14 17:49:00 EST 2016
* Support `referralCode` prop, + set on org when confirming new user: [#737](https://github.com/cinema6/cwrx/issues/737)
* Extra deployment steps:
    * Update system user's policy with `fieldValidation.orgs.referralCode.__allowed = true`

### 3.0.1: Mon Jan 11 12:36:22 EST 2016
* [FIX]: Cease recursive validation if a field is unchanged: [#728](https://github.com/cinema6/cwrx/pull/728)
* Add support for `decorated` query param on POST + PUT user endpoints: [#729](https://github.com/cinema6/cwrx/pull/729)
* [FIX]: Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)

### 3.0.0: Fri Dec 18 10:57:31 EST 2015
* [BREAKING CHANGE]: Do not create customers on user confirmation: [#697](https://github.com/cinema6/cwrx/pull/697)
* [BREAKING CHANGE]: Do not store `advertiser` ids on users: [#697](https://github.com/cinema6/cwrx/pull/697)

### 2.2.1: Wed Dec  2 14:05:09 EST 2015
* [FIX]: Do not put the user into `'error'` state if confirmation fails: [#668](https://github.com/cinema6/cwrx/issues/668)
* Extra deployment steps: None

### 2.2.0: Tue Nov 24 11:52:12 EST 2015
* [FEATURE]: Add job manager to userSvc to send 202s for long requests: [#638](https://github.com/cinema6/cwrx/issues/638)
* Extra deployment steps: None

### 2.1.4: Fri Nov 20 15:48:37 EST 2015
* [FIX]: Fix spacing on logo in email templates [#645](https://github.com/cinema6/cwrx/issues/645)
* Changing user's email sends messages to new + old address: [#642](https://github.com/cinema6/cwrx/issues/642)
* Extra deployment steps: None

### 2.1.3: Tue Nov 10 11:25:27 EST 2015
* Integrate designed email templates: [#553](https://github.com/cinema6/cwrx/issues/553)
* Extra deployment steps:
    * Deploy userSvc cookbook 1.3.9 to staging/production envs

### 2.1.2: Thu Nov  5 12:13:27 EST 2015
* [FIX]: Fix for an issue that arose on concurrent confirmation requests: [#567](https://github.com/cinema6/cwrx/issues/567)
* Allow `null` to be set for validated fields: [#573](https://github.com/cinema6/cwrx/pull/573)
* Expire login sessions after 30 minutes: [#487](https://github.com/cinema6/cwrx/issues/487)
* Extra deployment steps:
    * Deploy userSvc cookbook 1.3.8 to staging/production envs
    * Test environments need to be updated to run memcached and monitor

### 2.1.1: Wed Oct 14 18:47:35 EDT 2015
* [FIX]: Fix for an issue that prevented cookie being returned for internal endpoint in staging: [#566](https://github.com/cinema6/cwrx/pull/566)
* [FIX]: Fix for an issue that prevented newly signed up users from receiving roles and policies: [#564](https://github.com/cinema6/cwrx/pull/564)
* Extra deployment steps: None

### 2.1.0: Tue Oct 13 14:35:41 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* [FEATURE]: Add resend activation endpoint: [#508](https://github.com/cinema6/cwrx/issues/508)
* [FEATURE]: Add new user confirmation endpoint: [#484](https://github.com/cinema6/cwrx/issues/484)
* [FIX]: Setting `ids` user filter param to `''` returns no users: [#524](https://github.com/cinema6/cwrx/issues/524)
* [FEATURE]: Add new user signup endpoint: [#483](https://github.com/cinema6/cwrx/issues/483)
* Extra deployment steps:
    * Deploy new userSvc cookbook to staging/production envs
    * Create sixxy user for staging + production environments with permissions to create orgs, customers, and advertisers

### 2.0.0: Mon Sep 28 10:33:32 EDT 2015
* [FIX]: Validate pagination params: [#512](https://github.com/cinema6/cwrx/issues/512)
* [FEATURE]: Add handling for `fields` param: [#454](https://github.com/cinema6/cwrx/issues/454)
* [FEATURE]: Add endpoints for roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* [FIX]: Use Model to validate user docs: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps:
    * Deploy updated cookbook
    * Update c6mongo cfg in environments to setup role + policy indexes
    * Update proshop to correctly create + edit users, roles, and policies

###  1.8.2: Mon Jul 20 17:22:58 EDT 2015
* [REFACTOR]: Re-write to use CrudSvc: [#446](https://github.com/cinema6/cwrx/issues/446)
* Multi-get endpoint now returns 200: [] when no users are found instead of a 404: [#337](https://github.com/cinema6/cwrx/issues/337)

### 1.8.1: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.8.0: Wed Feb  4 17:16:46 EST 2015
* [FEATURE]: Add ability to query by list of ids: [#365](https://github.com/cinema6/cwrx/pull/365)
* Extra deployment steps: None

### 1.7.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.6.4: Fri Oct  3 12:52:39 EDT 2014
* [FIX]: Defend against query selector injection attacks: [#303](https://github.com/cinema6/cwrx/pull/303)
* Extra deployment steps: None

### 1.6.3: Mon Sep 22 14:08:00 EDT 2014
* [FIX]: Give default users permission to read org's sites: [#285](https://github.com/cinema6/cwrx/pull/285)
* Extra deployment steps: Update existing users with site permissions

### 1.6.2: Fri Sep 12 16:00:28 EDT 2014
* [FIX]: Check equality of existing permissions before rejecting on PUT: [#280](https://github.com/cinema6/cwrx/pull/280)
* Extra deployment steps: None

### 1.6.1: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FEATURE]: Add endpoint for deleting users' login sessions: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.6.0: Mon Aug 18 14:31:18 EDT 2014
* [FEATURE]: Send Content-Range header when paginating orgs: [#257](https://github.com/cinema6/cwrx/pull/258)
* Extra deployment steps: None

### 1.5.5: Mon Aug 18 09:56:07 EDT 2014
* [FIX]: By default, allow users to read org-level users and edit own org: [#255](https://github.com/cinema6/cwrx/pull/255)
* Extra deployment steps: None

### 1.5.4: Mon Aug 11 10:09:05 EDT 2014
* [FIX]: Default new users' type to 'Publisher': [#250](https://github.com/cinema6/cwrx/pull/250)
* Extra deployment steps: None

### 1.5.3: Mon Aug  4 12:40:36 EDT 2014
* [FIX]: Fix hardcoding new users' config: [#242](https://github.com/cinema6/cwrx/pull/242)
* Extra deployment steps: None

### 1.5.2: Tue Jul 29 15:07:19 EDT 2014
* [FIX]: Allow admins to change users' orgs: [#235](https://github.com/cinema6/cwrx/pull/235)
* [FIX]: Properly allow overriding the default applications list: [#235](https://github.com/cinema6/cwrx/pull/235)
* Extra deployment steps: None

### 1.5.1: Fri Jul 25 15:37:41 EDT 2014
* [FIX]: Force emails to lowercase: [#228](https://github.com/cinema6/cwrx/pull/228)
* Extra deployment steps: Convert all existing user's email addresses to lowercase

### 1.5.0: Thu Jul 24 10:05:01 EDT 2014
* [FIX]: Setup default config object on new users: [#224](https://github.com/cinema6/cwrx/pull/224)
* [FEATURE]: Allow admins to query for all users: [#219](https://github.com/cinema6/cwrx/pull/219)
* [FEATURE]: Email notifications for account updates: [#209](https://github.com/cinema6/cwrx/pull/209)
* Extra deployment steps:
    * Deploy new userSvc cookbook to staging/production envs
    * Verify that staging/production IAM roles have proper access to SES

### 1.4.4: Wed Jul 16 12:52:22 EDT 2014
* [FIX]: Update default user perms to allow org-level exp edits: [#211](https://github.com/cinema6/cwrx/pull/211)
* Extra deployment steps: None

### 1.4.3: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* [FIX]: Check for existing user with newEmail when changing email: [#153](https://github.com/cinema6/cwrx/pull/153)
* Extra deployment steps: None

### 1.4.2: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* Extra deployment steps: None

### 1.4.1: Wed Apr 30 10:44:00 EDT 2014
* [FIX]: Use email field in place of username: [#124](https://github.com/cinema6/cwrx/pull/124)
* Extra deployment steps: None
