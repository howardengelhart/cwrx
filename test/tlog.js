/*
 * This script is used by the logger.spec.js test suite!
 */

var path   = require('path'),
    logger = require('../lib/logger'),
    logDir = path.join(__dirname,'logs'),
    test   = process.argv[2];

if (test === 'exit1'){
    testExit1();
} else
if (test === 'exit2'){
    testExit2();
} else
if (test === 'exit3'){
    testExit3();
} else {
    console.error('I do not know test: ' + test);
    process.exit(2);
}

function testExit1(){
    var log = logger.createLog({
                logLevel : 'TRACE',
                logDir   : logDir,
                logName  : 'exit1.log',
                media    : [ { type : 'file' } ]

    });

    log.info('abcdefghijklmnopqrstuvwxyz');
}

function testExit2(){
    var log = logger.createLog({
                logLevel : 'TRACE',
                logDir   : logDir,
                logName  : 'exit2.log',
                media    : [ { type : 'file' } ]

    });

    log.info('abcdefghijklmnopqrstuvwxyz');
    process.exit(0);
}

function testExit3(){
    var log = logger.createLog({
                logLevel : 'TRACE',
                logDir   : logDir,
                logName  : 'exit3.log',
                media    : [ { type : 'file' } ]

    });

    log.info('abcdefghijklmnopqrstuvwxyz');
    throw new Error('I am dying with an error');
}
