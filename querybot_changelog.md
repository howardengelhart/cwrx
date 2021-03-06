# QueryBot Service Changelog

### 1.6.3 Mon Aug  1 10:02:35 EDT 2016
* Transition to the updated method of signing authenticated app requests: [#983](https://github.com/cinema6/cwrx/pull/983)

### 1.6.2 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 1.6.1: Fri Jul  8 14:07:03 EDT 2016
* [FIX]: Use description or new application field in billing_transactions to identify showcase apps payments for billing cycle logic. [#970](https://github.com/cinema6/cwrx/issues/970)

### 1.6.0: Thu Jun 16 15:50:47 EDT 2016
* [FEATURE]: Adding ability to pull data for current billing cycle.

### 1.5.2: Thu May 26 10:15:08 EDT 2016
* [FEATURE]: Use memcache for ssb query results.
* [FEATURE]: Added cloudwatch metrics for ssb query.

### 1.5.1: Wed May 18 16:48:09 EDT 2016
* [FIX]: Handle error when no data is found for a valid campaign.

### 1.5.0: Tue May 17 22:50:14 EDT 2016
* [FEATURE]: Support for slide show bob apps
* [DEV]: Restructured querybot to separate out different query types

### 1.4.1: Fri Apr  8 15:27:09 EDT 2016
* [FIX]: Quartiles adjusting for billable views: [#854](https://github.com/cinema6/cwrx/issues/854)
* [DEV]: Updates to Vagrant, initcamp to enable auto running of the initcamp.sh script after a vagrant up.  Also, fixed issue with c6postgres breaking vagrant:provision.

### 1.4.0: Thu Mar 31 18:10:22 EDT 2016
* [FEATURE]: Use billable_transactions for getting views and spend data [#840)[https://github.com/cinema6/cwrx/issues/840]
* Extra deployment steps:
    * querybot,accountant,c6env cookbooks need to be updated to migrate management of the pgpass file from the daemons to c6env.

### 1.3.3: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 1.3.2: Thu Mar 10 11:11:28 EST 2016
* Changed ref to rpt.campaign_summary_hourly_all to rpt.campaign_summary_hourly: [#744](https://github.com/cinema6/cwrx/issues/744)

### 1.3.1: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* Extra deployment steps: None

### 1.3.0: Thu Feb 25 15:06:26 EST 2016
* [FEATURE] : Adds quartiles to data. : [#800](https://github.com/cinema6/cwrx/issues/800)
* [FEATURE] : Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)

### 1.2.1: Tue Jan 19 12:33:29 EST 2016
* [FIX] : Fixed cloudwatch metrics (wrong metric going to wrong name) : [#743](https://github.com/cinema6/cwrx/issues/743)

### 1.2.0: Fri Jan 15 13:55:57 EST 2016
* [FIX]: Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)
* [FEATURE] : Support dates in query params, add data to campaign summary response : [#719](https://github.com/cinema6/cwrx/issues/719)
* [FEATURE] : Add cloudwatch metric gathering for api method response times.

### 1.1.0: Wed Dec  2 22:56:03 EST 2015
* [FEATURE] : Updated query to handle new table/view structures of data (no more crosstab)
* [FEATURE] : Added additional data for selfie campaign stats tab : [#664](https://github.com/cinema6/cwrx/issues/664)

### 1.0.1: Thu Oct 15 13:24:56 EDT 2015
* [FIX]: Stop logging cookie header: [#539](https://github.com/cinema6/cwrx/issues/539)
* Extra deployment steps: None

### 1.0.0: Wed Oct  7 17:42:07 EDT 2015
* Initial querybot service ready to be deployed to staging
