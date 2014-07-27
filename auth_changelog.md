# Auth Service Changelog

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
