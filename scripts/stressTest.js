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

    function sendRequest(reqOpts, reqNum, testId) {
        var start = new Date(),
            deferred = q.defer(),
            code = reqOpts.code || 200,
            resp = {
                start: start,
                url: reqOpts.url,
                data: reqOpts.json
            };
        resp.reqNum = reqNum;
        reqOpts.headers = { testId: testId, reqNum: reqNum };
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
                resp.error = 'Got ' + response.statusCode + ' instead of ' + code;
                return deferred.reject(resp);
            }
            return deferred.resolve(resp);
        });
        
        return deferred.promise;
    }
    
    function dualWrite(msg, stream) {
        console.log(msg);
        stream.write(msg + '\n');
    }
    
    function reportPercentiles(list, stream) {
        dualWrite('---------------------------------', stream);
        dualWrite('Percentiles:', stream);
        var percentiles = [0.99, 0.98, 0.97, 0.96, 0.95, 0.9, 0.8, 0.75, 0.5, 0.25, 0.1];
        list.sort(function(a, b) { return a.elapsed - b.elapsed; });
        percentiles.forEach(function(percentile) {
            var bin = Math.round(percentile * list.length) - 1;
            dualWrite(Math.round(percentile * 100) + '%:\t' + list[bin].elapsed, stream);
        });
    }
    
    function writeResults(successes, failures, stream, verbose) {
        if (successes.length) stream.write('Successes: \n');
        stream.write(successes.map(function(s) {
            return 'ReqNum: ' + s.reqNum + ',  \tStart: ' + s.start.toISOString() + ',   End: ' + s.end.toISOString() +
                   ',   Elapsed: ' + s.elapsed + ',\tUrl: ' + s.url;
        }).join('\n'));
        stream.write('\n----------------------------------------------------------------------\n');
        if (failures.length) stream.write('Failures: \n');
        stream.write(failures.map(function(f) {
            if (program.verbose) {
                return 'ReqNum: ' + f.reqNum + ',  \tStart: ' + f.start.toISOString() + ',   End: ' + f.end.toISOString() +
                       ',   Elapsed: ' + f.elapsed + ',\tCode: ' + f.code + ',   Error: ' + f.error + ',   Url: ' + f.url;
            } else {
                return 'ReqNum: ' + f.reqNum + ',  \tStart: ' + f.start.toISOString() + ',   End: ' + f.end.toISOString() +
                       ',   Elapsed: ' + f.elapsed + ',\tCode: ' + f.code + ',   Url: ' + f.url;
            }
        }).join('\n'));
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
            .option('-o, --output [FILE]','File to output info to', 'out.txt')
            .option('-v, --verbose','Output all error messages')
            .parse(process.argv);
        if (!program.url && !program.config) {
            throw new Error('Must provide a target url or a config file with requests to make');
        }
        
        var requests = (program.config && program.config.requests) ||
                       [ { url: program.url, json: program.data } ],
            testId = Math.round(Math.random() * 10000000),
            stream = fs.createWriteStream(program.output),
            sentReqs = 0, successes = [], failures = [];

        dualWrite('TestId:\t' + testId, stream);
        if (program.config && program.config.requests) {
            dualWrite('Test Endpoints:', stream);
            dualWrite(program.config.requests.map(function(request) { return request.url; }).join('\n'), stream);
        } else {
            dualWrite('Test Endpoint:\t' + program.url, stream);
        }
        dualWrite('Tests started at ' + new Date().toISOString(), stream);
        dualWrite('---------------------------------', stream);
        process.nextTick(function sendBatchReqs() {
            var promises = [],
                reqsToMake = Math.min(program.concurrency, program.numRequests - sentReqs);

            for (var i = 0; i < reqsToMake; i++) {
                var randReq = requests[Math.floor(Math.random() * requests.length)];
                promises.push(sendRequest(randReq, sentReqs, testId));
                sentReqs++;
            }
            
            q.allSettled(promises).done(function(results) {
                dualWrite('Finished batch of ' + results.length + ' results at ' +
                            new Date().toISOString(), stream);
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
                    dualWrite('---------------------------------', stream);
                    dualWrite(list.name + ':', stream);
                    dualWrite('Number: ' + list.length, stream);
                    if (list.length === 0) {
                        return;
                    }
                    if (list.name === 'All Responses' && (list.length === successes.length || 
                                                          list.length === failures.length)) {
                        return;
                    }
                    dualWrite('Average time:\t' + avg(list), stream);
                    var minTime = min(list), maxTime = max(list);
                    dualWrite('Best time:\t\t' + minTime.elapsed + ',\t' + ' ReqNum: ' + minTime.reqNum, stream);
                    dualWrite('Worst time:\t\t' + maxTime.elapsed + ',\t' + ' ReqNum: ' + maxTime.reqNum, stream);
                });
                reportPercentiles(allResponses, stream);
                dualWrite('---------------------------------', stream);
                writeResults(successes, failures, stream, program.verbose);
                stream.end();
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
