# Content Service Changelog

### 1.17.0: Mon Aug 10 14:46:38 EDT 2015
* [FEATURE]: Add support for `pageUrl` query parameter to
  `GET /api/public/content/experience/:id` to override site lookup

### 1.16.1: Wed Jun 24 18:09:44 EDT 2015
* [FIX]: Cookie and session security improvements: [#423](https://github.com/cinema6/cwrx/pull/423)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Set `sessions.secure = true` for staging + production environments

### 1.16.0: Mon May 18 15:06:37 EDT 2015
* [FEATURE]: Implement Job Timeouts: [#421](https://github.com/cinema6/cwrx/pull/421)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Update chef environments so memcached is installed on ASG nodes
    * Open ports for memcached and give API servers permissions for querying AutoScaling API

### 1.15.0: Thu Feb 26 11:01:27 EST 2015
* [FEATURE]: Add `GET /api/public/content/card/:id` endpoint: [#382](https://github.com/cinema6/cwrx/pull/382)
* [FEATURE]: Update `GET /api/public/content/experience/:id` endpoint to handle campaigns: [#382](https://github.com/cinema6/cwrx/pull/382)
* [FIX]: Public experience endpoint handles the `preview` param: [#400](https://github.com/cinema6/cwrx/pull/400)
* [FIX]: Only update latest entry in `data` array for experience: [#382](https://github.com/cinema6/cwrx/pull/382)
* Extra deployment steps: None

### 1.14.3: Fri Feb 13 16:04:45 EST 2015
* [FIX]: Rotate branding for csv-style branding lists: [#373](https://github.com/cinema6/cwrx/pull/373)
* [FIX]: Set `lastStatusChange` virtual property for minireels: [#373](https://github.com/cinema6/cwrx/pull/373)
* [FIX]: Don't cache public endpoint responses if origin is staging or portal studio: [#373](https://github.com/cinema6/cwrx/pull/373)
* Extra deployment steps: None

### 1.14.2: Tue Feb 10 11:26:31 EST 2015
* [FIX]: Override host to `cinema6.com` if container is `connatix` or `veeseo`: [#366](https://github.com/cinema6/cwrx/pull/366)
* [FIX]: Add ability to query for experiences by `categories`: [#367](https://github.com/cinema6/cwrx/pull/367)
* [FIX]: Add ability to query for sponsored/non-sponsored experiences: [#367](https://github.com/cinema6/cwrx/pull/367)
* [FIX]: Remove ability to query by `sponsoredType` (unused): [#367](https://github.com/cinema6/cwrx/pull/367)
* Extra deployment steps: Setup index on `categories` field

### 1.14.1: Mon Jan 26 17:10:33 EST 2015
* [FIX]: Public endpoint fetches placements from site container: [#360](https://github.com/cinema6/cwrx/pull/360)
* [FIX]: Public endpoint no longer changes mode based on context: [#360](https://github.com/cinema6/cwrx/pull/360)
* Extra deployment steps: None

### 1.14.0: Thu Jan 15 13:59:47 EST 2015
* [FEATURE]: Add API endpoints for cards: [#355](https://github.com/cinema6/cwrx/pull/355)
* [FEATURE]: Add API endpoints for categories: [#355](https://github.com/cinema6/cwrx/pull/355)
* Extra deployment steps: None

### 1.13.7: Wed Dec 17 13:47:05 EST 2014
* [FIX]: Stop logging warnings for unknown sites: [#346](https://github.com/cinema6/cwrx/pull/346)
* Extra deployment steps: None

### 1.13.6: Mon Dec  8 10:47:52 EST 2014
* [FIX]: Respect other lightbox modes when context is `mr2`: [#345](https://github.com/cinema6/cwrx/pull/345)
* Extra deployment steps: None

### 1.13.5: Wed Dec  3 12:00:40 EST 2014
* [FIX]: Override site query if `container=veeseo`: [#340](https://github.com/cinema6/cwrx/pull/340)
* Extra deployment steps: None

### 1.13.4: Tue Dec  2 17:33:57 EST 2014
* [FIX]: Always take branding + placements from query params, regardless of context: [#338](https://github.com/cinema6/cwrx/pull/338)
* Extra deployment steps: None

### 1.13.3: Wed Nov 12 16:35:55 EST 2014
* [FIX]: Remove default values for site exceptions: [#326](https://github.com/cinema6/cwrx/pull/326)
* Extra deployment steps: Deploy new content cookbook

### 1.13.2: Fri Nov  7 11:46:54 EST 2014
* [FIX]: Whitelist certain public sites as `cinema6.com` sites: [#323](https://github.com/cinema6/cwrx/pull/323)
* [FIX]: Allow localhost to be set as a site: [#322](https://github.com/cinema6/cwrx/pull/322)
* Extra deployment steps: Deploy new content cookbook

### 1.13.1: Wed Nov  5 17:08:20 EST 2014
* [FIX]: Set exp mode to 'lightbox' when content is 'mr2': [#318](https://github.com/cinema6/cwrx/pull/318)
* [FIX]: Add `wildCardPlacement` to site lookup: [#316](https://github.com/cinema6/cwrx/pull/316)
* Extra deployment steps:
    * Deploy new content cookbook and update environments with default `wildCardPlacement`

### 1.13.0: Fri Oct 17 14:28:44 EDT 2014
* [FEATURE]: Add journaling: [#309](https://github.com/cinema6/cwrx/pull/309)
* Extra deployment steps:
    * Deploy new c6mongo and create capped audit collection
    * Deploy new cookbook and update environment with c6Journal config

### 1.12.0: Wed Oct 15 09:59:07 EDT 2014
* [FEATURE]: Allow querying for experiences by title: [#308](https://github.com/cinema6/cwrx/pull/308)
* Extra deployment steps: None

### 1.11.0: Wed Oct  8 14:59:44 EDT 2014
* [FEATURE]: Add `/preview/:id` endpoint for generating full preview links: [#299](https://github.com/cinema6/cwrx/pull/299)
* Extra deployment steps: 
    * Deploy new content cookbook with nginx config change
    * Ensure Cloudfront behaviors and new DNS records properly setup

### 1.10.0: Fri Oct  3 12:52:39 EDT 2014
* [FEATURE]: Allow querying experiences by status: [#303](https://github.com/cinema6/cwrx/pull/303)
* [FIX]: Allow cinema6.com to be added to the `publicC6Sites` list: [#303](https://github.com/cinema6/cwrx/pull/303)
* [FIX]: Defend against query selector injection attacks: [#303](https://github.com/cinema6/cwrx/pull/303)
* Extra deployment steps: None

### 1.9.1: Mon Sep 29 16:33:39 EDT 2014
* [FIX]: Update site querying logic to allow greater flexibility in hosts: [#298](https://github.com/cinema6/cwrx/pull/298)
* Extra deployment steps: None

### 1.9.0: Mon Sep 22 14:08:00 EDT 2014
* [FEATURE]: Dynamically set `branding` and `placementId` for experiences retrieved from public endpoint: [#285](https://github.com/cinema6/cwrx/pull/285)
* [FIX]: Set `data.mode` to `lightbox-ads` when context is `mr2`: [#291](https://github.com/cinema6/cwrx/pull/291)
* Extra deployment steps: None

### 1.8.1: Wed Sep 10 11:07:04 EDT 2014
* [FIX]: Add permission for editing experiences' `adConfig`: [#272](https://github.com/cinema6/cwrx/pull/272)
* [FIX]: Properly compare `adConfig` with existing `adConfig` on edit: [#275](https://github.com/cinema6/cwrx/pull/275)
* [FIX]: Optimize queries using hints: [#273](https://github.com/cinema6/cwrx/pull/273)
* Extra deployment steps: Update existing C6 admins with `editAdConfig` permission

### 1.8.0: Wed Sep  3 14:30:31 EDT 2014
* [FEATURE]: Allow querying experiences by status: [#268](https://github.com/cinema6/cwrx/pull/268)
* Extra deployment steps: Create database index on `status.0.status` field

### 1.7.1: Fri Aug 29 10:07:58 EDT 2014
* [FIX]: Save session docs as JSON, not strings: [#261](https://github.com/cinema6/cwrx/pull/261)
* [FIX]: Change mongo read preference to primaryPreferred: [#262](https://github.com/cinema6/cwrx/pull/262)
* Extra deployment steps: Delete/convert existing stringified sessions

### 1.7.0: Mon Aug 18 09:56:07 EDT 2014
* [FEATURE]: Send Content-Range header when paginating experiences: [#257](https://github.com/cinema6/cwrx/pull/257)
* [FEATURE]: Set `lastPublished` date on experiences when returning to client: [#255](https://github.com/cinema6/cwrx/pull/255)
* [FIX]: Default experiences to public: [#255](https://github.com/cinema6/cwrx/pull/255)
* Extra deployment steps: None

### 1.6.2: Mon Aug 11 10:09:05 EDT 2014
* [FIX]: Trim off title and versionId fields when creating experiences: [#251](https://github.com/cinema6/cwrx/pull/251)
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
