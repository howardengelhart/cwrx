# Collateral Service Changelog

### 2.6.0: Thu Jul 21 13:23:15 EDT 2016
* [FEATURE]: Add `websites` to app product data: [#977](https://github.com/cinema6/cwrx/pull/977)

### 2.5.0: Tue Jul 19 14:11:46 EDT 2016
* [FEATURE]: Add additional image metadata to App product data : [#963] (https://github.com/cinema6/cwrx/pull/963)
* [FEATURE]: Add `'[GET] /api/collateral/video-data`: [#942] (https://github.com/cinema6/cwrx/pull/942)
* [FIX]: Provide the number of reviews when GETting app product-data: [#942](https://github.com/cinema6/cwrx/pull/942)

### 2.4.1: Tue May 24 15:00:42 EDT 2016
* Set `Access-Control-Allow-Origin` to `'*'` on public endpoints: [#908](https://github.com/cinema6/cwrx/pull/908)
* Extra deployment steps: None

### 2.4.0: Mon May 16 09:05:41 EDT 2016
* [FEATURE]: Provide the name of the developer and star-rating when
  GETting app product-data: [#895](https://github.com/cinema6/cwrx/pull/895)

### 2.3.0: Thu Apr 28 16:08:23 EDT 2016
* [FEATURE]: Add `[GET] /api/public/collateral/website-data`: [#884](https://github.com/cinema6/cwrx/pull/884)
* [FEATURE]: Add `[GET] /api/public/collateral/product-data`: [#884](https://github.com/cinema6/cwrx/pull/884)
* [FEATURE]: Add `[GET] /api/collateral/product-data` endpoint for
  fetching and normalizing data about products from various e-commerce
  platforms: [#832](https://github.com/cinema6/cwrx/pull/832),
  [#873](https://github.com/cinema6/cwrx/pull/873),
  [#879](https://github.com/cinema6/cwrx/pull/879)
* **Extra deployment steps:**
    * Deploy `v1.2.0` of the collateral cookbook

### 2.2.3: Thu Mar 24 14:13:05 EDT 2016
* [FIX]: Handle non-existent server addresses more gracefully when
  scraping social links: [#829](https://github.com/cinema6/cwrx/pull/829)
* Extra deployment steps: None

### 2.2.2: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 2.2.1: Mon Mar 14 11:43:43 EDT 2016
* [FIX]: Compress job results written to memcached: [#819](https://github.com/cinema6/cwrx/issues/819)
* Extra deployment steps: None

### 2.2.0: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* [FEATURE]: Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)
* Extra deployment steps: None

### 2.1.1: Fri Jan 15 11:20:29 EST 2016
* Improve the accuracy of social link web-scraping: [#740](https://github.com/cinema6/cwrx/pull/740)
* [FIX]: Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)

### 2.1.0: Fri Nov 20 15:48:37 EST 2015
* [FIX]: Suppoprt re-uploading URIs with query parameters: [#640](https://github.com/cinema6/cwrx/issues/640)
* [FEATURE]: Add `[GET] /api/collateral/website-data` endpoint for
  scraping a website for social data: [#644](https://github.com/cinema6/cwrx/issues/644)
* Extra deployment steps: None

### 2.0.4: Thu Oct 15 13:24:56 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* Extra deployment steps: None

### 2.0.3: Wed Sep 30 12:39:01 EDT 2015
* [FIX]: Solve issue with some https images not rendering properly in phantom: [#517](https://github.com/cinema6/cwrx/pull/517)
* Extra deployment steps: None

### 2.0.2: Wed Sep 16 17:09:59 EDT 2015
* [FIX]: Specifying "data:" URIs for re-upload will cause 400s not 500s: [#472](https://github.com/cinema6/cwrx/issues/472)
* [FIX]: Auth middleware will handle users with roles + policies: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps: None

### 2.0.1: Thu Jul 16 18:18:01 EDT 2015
* [FIX]: Time-out uri endpoint downloads if they take too long: [#456](https://github.com/cinema6/cwrx/issues/456)
* [FIX]: Respond with a 400 if an invalid URI is sent to the uri endpoint: [#457](https://github.com/cinema6/cwrx/issues/457)
* Extra deployment steps:
    * Deploy new version of collateral cookbook

### 2.0.0: Tue Jul  7 16:30:16 EDT 2015
* Refactor so that uploaded files are stored by user on S3: [#438](https://github.com/cinema6/cwrx/issues/438)
* [DEPRECATION]: Removed support for "versionate" query param. All files
  are now versionated by default
* [DEPRECATION]: Removed support for "noCache" query param. All files
  now have a max-age of one year
* [FEATURE]: Added new endpoint for splash image generation:
  POST "/api/collateral/splash"
* [FEATURE]: Added POST /api/collateral/uris endpoint for re-uploading
  external image resources to Cinema6's servers: [#439](https://github.com/cinema6/cwrx/issues/439)
* [FEATURE]: Add support for job-chaching protocol to
  [POST /api/collateral/files/:expId], [POST /api/collateral/files],
  [POST /api/collateral/splash/:expId], and
  [POST /api/collateral/splash]: [#440](https://github.com/cinema6/cwrx/issues/440)
* Extra deployment steps:
    * Environments should be updated so that the ```s3.path``` config
      only points to "/collateral"
    * Deploy new version of collateral cookbook

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
