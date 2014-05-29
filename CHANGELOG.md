# cwrx Changelog

## auth Service
### 1.2.4: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.2.3: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* Extra deployment steps: None

### 1.2.2: Wed Apr 30 10:44:00 EDT 2014
* [FIX]: Use email field in place of username: [#124](https://github.com/cinema6/cwrx/pull/124)
* Extra deployment steps: None

## collateral Service
### 1.2.2: Thu May 29 04:11:00 EDT 2014
* [FIX]: Splash templates renamed: [#169](https://github.com/cinema6/cwrx/pull/169)
* Extra deployment steps: None

### 1.2.1: Thu May 29 11:24:53 EDT 2014
* [FIX]: Explicitly set Content-Type for uploaded images, but not extensions: [#166](https://github.com/cinema6/cwrx/pull/166)
* Extra deployment steps: None

### 1.2.0: Fri May 23 10:35:35 EDT 2014
* [FIX]: Add endpoint for splash generation: [#160](https://github.com/cinema6/cwrx/pull/160)
* Extra deployment steps:
    * Deploy collateral cookbook v0.2.0 to all environments

### 1.1.0: Tue May 20 11:55:10 EDT 2014
* [FIX]: Add endpoint for uploading to experience: [#157](https://github.com/cinema6/cwrx/pull/157)
* Extra deployment steps: None

### 1.0.1: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.0.0: Mon May  5 14:36:24 EDT 2014
* First deployment: [#127](https://github.com/cinema6/cwrx/pull/127)
* Extra deployment steps:
    * Push up update to staging environment to include collateral service

## content Service
### 1.3.8: Thu May 29 12:09:09 EDT 2014
* [FIX]: Store userId in data+status arrays: [#168](https://github.com/cinema6/cwrx/pull/168)
* Extra deployment steps: None

### 1.3.7: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.3.6: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* [FIX]: Return 200 if nothing found when getting multiple experiences: [#148](https://github.com/cinema6/cwrx/pull/148)
* Extra deployment steps: None

### 1.3.5: Wed May  7 16:28:53 EDT 2014
* [FIX]: Prevent editing deleted experience: [#145](https://github.com/cinema6/cwrx/pull/145)
* Extra deployment steps: None

### 1.3.4: Tue May  6 15:52:57 EDT 2014
* [FIX]: Copy exp.data.title into exp.title: [#141](https://github.com/cinema6/cwrx/pull/141)
* Extra deployment steps: None

### 1.3.3: Wed Apr 30 10:44:00 EDT 2014
* [FIX]: Use email field in place of username: [#124](https://github.com/cinema6/cwrx/pull/124)
* Extra deployment steps:
    * Create email fields for users in staging + production dbs
    * Edit c6mongo chef config to build indexes on email + give johnnyTestmonkey an email

## userSvc Service
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

## vote Service
### 1.3.3: Thu May  8 18:32:05 EDT 2014
* [FIX]: Fix mongo reconnect: [#151](https://github.com/cinema6/cwrx/pull/151)
* Extra deployment steps: None

### 1.3.2: Thu May  8 12:39:02 EDT 2014
* [FIX]: Escape/unescape keys in mongo objects: [#147](https://github.com/cinema6/cwrx/pull/147)
* Extra deployment steps: None
