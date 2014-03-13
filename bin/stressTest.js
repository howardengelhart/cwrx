(function(){
    'use strict';
    var program = require('commander'),
        fs      = require('fs-extra'),
        request = require('request'),
        q       = require('q');

    /*function sendRequest(url, data, opts) {
        var reqOpts = { url: url };
        if (data) {
            reqOpts.json = data;
        }
        q.npost(request, method, reqOpts)
        .then(function(values) {
            if (!values) {
                return q.reject('Received no data');
            }
            if (values[0].statusCode !== opts.expectedCode) {
                return q.reject();
            }
        }).catch(function(error) {
            
        });
    }*/

    function main(done){
        program
            .version('0.0.1')
            .option('--concurrency [REQS]','Max number of simultaneous requests', parseInt, 10)
            .option('-n, --numRequests [REQS]','Total Number of requests to make', parseInt, 100)
            .option('-r, --responseCode [CODE]','Expected response code', parseInt, 200)
            .option('-u, --url [URL]','Url to send requests to')
            .option('-d, --data [JSON]','Stringified JSON data', JSON.parse, {})
            .option('-c, --config [FILE]','Config file with requests to make', fs.readJsonSync)
            // .option('-o, --output [console|json]','Specify whether output should go to // TODO think about something like this
            .option('-v, --verbose','Log all error messages')
            .parse(process.argv);
        if (!program.url && !program.config) {
            throw new Error('Must provide a target url or a config file with requests to make');
        }
        
        var requests = program.config.requests || [ { url: program.url, json: program.data } ],
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
                results.forEach(function(result) {
                    if (result.state === 'fulfilled') {
                        successes.push(result.value);
                    } else {
                        failures.push(result.reason);
                    }
                });
                
                if (sentReqs < program.numRequests) {
                    process.nextTick(sendBatchReqs());
                } else {
                    var allResponses = success.concat(failures);
                    console.log('Number of successes: ' + successes.length);
                    console.log('Number of failures: ' + failures.length);
                    if (failures.length && program.verbose) {
                        failures.forEach(function(failure) {
                            console.log(JSON.stringify(failure));
                        });
                    }
                    //TODO: stats
                }
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
