var logger = require('./lib/logger'),
    stackType = process.argv[2],
    log = logger.createLog({
            logLevel  : 'TRACE',
            media     : [   {
                            type : "file",
                            logName : "app.log",
                            logDir  : "./logs/",
                            }
                        ]
        }),start, elapsed, i;
if (stackType) {
    log.setLogStack(stackType);
}
start = new Date();
elapsed = 0;
for (i = 0; i < 100000; i++){
    log.info('this is log line: ' + i);
}
elapsed = (new Date()).valueOf() - start.valueOf();

console.log('Wrote ' + i + ' lines in ' + (elapsed / 1000) + ' seconds');
console.log('Mean lines per second : ' + (Math.round(i / elapsed) * 1000) );
console.log('Mean microseconds per line: ' + ((elapsed / i) * 1000) );

