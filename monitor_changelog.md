# Monitor Service Changelog

### 1.1.4 Mon Aug  1 10:02:35 EDT 2016
* Transition to the updated method of signing authenticated app requests: [#983](https://github.com/cinema6/cwrx/pull/983)

### 1.1.3 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 1.1.2: Thu Dec 24 14:01:59 EST 2015
* Add delayed retry if checking a service fails: [#535](https://github.com/cinema6/cwrx/issues/535)
* Extra deployment steps:
    * Lengthen ELB health check request timeout
    * Deploy version 1.0.0 of monitor cookbook

### 1.1.1: Wed Sep 16 17:09:59 EDT 2015
* [FIX]: Stop logging warning when a client disconnects from cacheCfg publisher: [#475](https://github.com/cinema6/cwrx/pull/475)
* Extra deployment steps: None

### 1.1.0: Mon May 18 15:06:37 EDT 2015
* [FEATURE]: Implement Job Timeouts: [#421](https://github.com/cinema6/cwrx/pull/421)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Update chef environments so memcached is installed on ASG nodes
    * Open ports for memcached and give API servers permissions for querying AutoScaling API
