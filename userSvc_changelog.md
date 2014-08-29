# User Service Changelog

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
