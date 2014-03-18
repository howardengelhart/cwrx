#!/usr/bin/env node
(function(){
    'use strict';
    var program = require('commander'),
        fs      = require('fs-extra'),
        request = require('request'),
        cp      = require('child_process'),
        http    = require('http'),
        url     = require('url'),
        q       = require('q');

    function sendRequest(reqOpts) {
        var start = new Date(),
            deferred = q.defer(),
            code = reqOpts.code || 200,
            resp = {
                start: start,
                url: reqOpts.url,
                data: reqOpts.json
            };
        reqOpts.pool = { maxSockets: 10000 };
        request(reqOpts, function(error, response, body) {
            var end = new Date();
            resp.end = end;
            resp.elapsed = end - start;
            if (error) {
                resp.error = error;
                return deferred.reject(resp);
            }
            if (!response) {
                resp.error = 'Received no data';
                return deferred.reject(resp);
            }
            resp.code = response.statusCode;
            resp.body = body;
            if (response.statusCode !== code) {
                resp.error = 'Got ' + response.statusCode + ' instead of ' + reqOpts.code;
                return deferred.reject(resp);
            }
            return deferred.resolve(resp);
        });
        
        return deferred.promise;
        /*var deferred = q.defer(), opts, start = new Date(), resp, data, req, parsed;
        parsed = url.parse(reqOpts.url);
        opts = {
            hostname : parsed.hostname,
            port     : parsed.port,
            path     : parsed.pathname,
            //hostname   : 'localhost',
            //port       : 80,
            //path       : '/share/meta',
            method   : 'GET',
            agent    : false
        };
        resp = { start: start};

        req = http.request(opts,function(res){
            resp.code = parseInt(res.statusCode,10);
            if (resp.code !== 200){
                resp.error = 'Got ' + resp.code + ' instead of 200';
                return deferred.reject(resp);
            }
            res.setEncoding('utf8');
            data = '';
            
            res.on('data',function(chunk){
                if (!resp.dataT) resp.dataT = new Date() - resp.start;
                data += chunk;
            });
            res.on('end',function(){
                resp.end = new Date();
                resp.elapsed = resp.end - resp.start;
                resp.body = data;
                deferred.resolve(resp);
            });
        });
        req.on('socket', function() {
            resp.socketT = new Date() - start;
        });
        req.setNoDelay(true);
        req.on('error',function(e){
            resp.end = new Date();
            resp.elapsed = resp.end - resp.start;
            resp.error = e;
            deferred.reject(e);
        });
        req.end();
        return deferred.promise;*/
        /*var deferred = q.defer(),
            start = new Date(),
            resp = { start: start };
        cp.exec('curl ' + reqOpts.url, function(error, stderr, stdout) {
            resp.elapsed = new Date() - start;
            if (error) {
                resp.error = error;
                deferred.reject(resp);
            } else {
                resp.body = stdout.trim();
                deferred.resolve(resp);
            }
        });
        return deferred.promise;*/
    }
    
    function avg(arr, prop) {
        prop = prop || 'elapsed';
        if (arr.length === 0) {
            return 0;
        }
        return arr.reduce(function(sum, val) {
            return sum += (val[prop] / arr.length);
        }, 0);
    }
    
    function max(arr) {
        if (arr.length === 0) {
            return 0;
        }
        return arr.reduce(function(best, curr) {
            var max = Math.max(best.elapsed, curr.elapsed);
            return max === best.elapsed ? best : curr;
        }, arr[0].elapsed);
    }
    
    function min(arr) {
        if (arr.length === 0) {
            return 0;
        }
        return arr.reduce(function(best, curr) {
            var min = Math.min(best.elapsed, curr.elapsed);
            return min === best.elapsed ? best : curr;
        }, arr[0].elapsed);
    }

    function main(done){
        program
            .version('0.0.1')
            .option('-c, --concurrency [REQS]','Max number of simultaneous requests', parseInt, 10)
            .option('-n, --numRequests [REQS]','Total Number of requests to make', parseInt, 100)
            .option('-r, --responseCode [CODE]','Expected response code', parseInt, 200)
            .option('-u, --url [URL]','Url to send requests to')
            .option('-d, --data [JSON]','Stringified JSON data', JSON.parse, {})
            .option('--config [FILE]','Config file with requests to make', fs.readJsonSync)
            .option('-v, --verbose','Log all error messages')
            .parse(process.argv);
        if (!program.url && !program.config) {
            throw new Error('Must provide a target url or a config file with requests to make');
        }
        
        var requests = (program.config && program.config.requests) ||
                       [ { url: program.url, json: program.data } ],
            sentReqs = 0, successes = [], failures = [];
        
        process.nextTick(function sendBatchReqs() {
            var promises = [],
                reqsToMake = Math.min(program.concurrency, program.numRequests - sentReqs);

            for (var i = 0; i < reqsToMake; i++) {
                var randReq = requests[Math.floor(Math.random() * requests.length)];
                promises.push(sendRequest(randReq));
                sentReqs++;
            }
            
            q.allSettled(promises).done(function(results) {
                console.log('Finished batch of ' + results.length + ' results at ' +
                            new Date().toISOString());
                results.forEach(function(result) {
                    if (result.state === 'fulfilled') {
                        successes.push(result.value);
                    } else {
                        failures.push(result.reason);
                    }
                });
                
                if (sentReqs < program.numRequests) {
                    process.nextTick(sendBatchReqs);
                    return;
                }
            
                var allResponses = successes.concat(failures);
                successes.name = 'Successes';
                failures.name = 'Failures';
                allResponses.name = 'All Responses';
                [successes, failures, allResponses].forEach(function(list) {
                    console.log('---------------------------------');
                    console.log(list.name + ':');
                    console.log('Number: ' + list.length);
                    if (list.length === 0) {
                        return;
                    }
                    if (list.name === 'All Responses' && (list.length === successes.length ||
                                                          list.length === failures.length)) {
                        return;
                    }
                    console.log('Average time: ' + avg(list));
                    var minTime = min(list), maxTime = max(list);
                    console.log('Best time: \t' + minTime.elapsed + ',\t' + ' started at: ' +
                                minTime.start.toISOString());
                    console.log('Worst time: \t' + maxTime.elapsed + ',\t' + ' started at: ' + 
                                maxTime.start.toISOString());
                    console.log('Average socketT: \t' + avg(list, 'socketT'));
                    console.log('Average dataT: \t' + avg(list, 'dataT'));
                    console.log('Average connectT: \t' + avg(list, 'connectT'));
                    if (list.name === 'Failures' && program.verbose) {
                        list.forEach(function(failure) {
                            console.log(JSON.stringify(failure));
                        });
                    }
                });
            });
        });
    }

    try {
        main(function(rc){
            process.exit(rc);
        });
    } catch(e){
        console.log(e.message);
        process.exit(1);
    }
}());
