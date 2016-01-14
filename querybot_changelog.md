# QueryBot Service Changelog

* Upgrade mongo driver to 2.x, fixing reconnect issues: [#717](https://github.com/cinema6/cwrx/pull/717)
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
