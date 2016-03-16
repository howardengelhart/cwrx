# QueryBot Service Changelog

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
