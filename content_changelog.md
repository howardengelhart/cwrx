# Content Service Changelog

### 1.6.2: Mon Aug 11 10:09:05 EDT 2014
* [FIX]: Allow admins to set different user and org when creating experiences: [#250](https://github.com/cinema6/cwrx/pull/250)
* Extra deployment steps: None

### 1.6.1: Fri Aug  8 10:09:35 EDT 2014
* [FIX]: Whitelist public cinema6.com sites for experience access control: [#249](https://github.com/cinema6/cwrx/pull/249)
* Extra deployment steps: None

### 1.6.0: Tue Aug  5 15:52:33 EDT 2014
* [FIX]: Use origin or referer header for access control: [#244](https://github.com/cinema6/cwrx/pull/244)
* [FEATURE]: Add JSONP endpoint: [#244](https://github.com/cinema6/cwrx/pull/244)
* Extra deployment steps: Ensure Cloudfront forwards Referer and Origin headers in staging/production

### 1.5.1: Mon Aug  4 12:04:17 EDT 2014
* [FIX]: Update access control for experiences using access prop and request origin: [#241](https://github.com/cinema6/cwrx/pull/241)
* Extra deployment steps: None

### 1.5.0: Thu Jul 24 17:11:39 EDT 2014
* [FEATURE]: Lookup adConfig from org for public GET experience endpoint: [#226](https://github.com/cinema6/cwrx/pull/226)
* Extra deployment steps: Deploy new version of content cookbook

### 1.4.1: Tue Jul  8 11:23:33 EDT 2014
* [FIX]: Prevent setting top-level versionId on PUTs: [#208](https://github.com/cinema6/cwrx/pull/208)
* Extra deployment steps: None

### 1.4.0: Mon Jun  9 15:34:44 EDT 2014
* [FEATURE]: Hashinate exp.data + store/return as versionId: [#184](https://github.com/cinema6/cwrx/pull/184)
* [FIX]: Hide user and org fields from guest user: [#184](https://github.com/cinema6/cwrx/pull/184)
* Extra deployment steps: None

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
