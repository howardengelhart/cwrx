# Monitor Service Changelog

* [FIX]: Stop logging warning when a client disconnects from cacheCfg publisher: [#475](https://github.com/cinema6/cwrx/pull/475)

### 1.1.0: Mon May 18 15:06:37 EDT 2015
* [FEATURE]: Implement Job Timeouts: [#421](https://github.com/cinema6/cwrx/pull/421)
* Extra deployment steps:
    * Deploy updated cookbooks
    * Update chef environments so memcached is installed on ASG nodes
    * Open ports for memcached and give API servers permissions for querying AutoScaling API
