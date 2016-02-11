#!/usr/bin/env node
var q               = require('q'),
    util            = require('util'),
    program         = require('commander'),
    mongoUtils      = require('../lib/mongoUtils'),
    requestUtils    = require('../lib/requestUtils'),
    Status          = require('../lib/enums').Status;

program
    .version('0.0.1')
    .option('--url [URL]', 'Url of data file to use', 'https://s3.amazonaws.com/c6.dev/data/US_zipcodes_2016-02-09__test_set.json.gz')
    .option('--dbName [DBNAME]', 'Name of db to write to', 'geoDb')
    .option('--authDb [AUTHDB]', 'Name of db to authenticate to', 'geoDb')
    .option('--dbHost [HOST]', 'Host of mongo instance', '33.33.33.100')
    .option('--dbPort [PORT]', 'Port of mongo instance', parseInt, 27017)
    .option('--dbUser [DBUSER]', 'Name of mongo user to use', 'e2eTests')
    .option('--force', 'If true, force re-saving all data', false)
    .parse(process.argv);

var db, userColl;

var data;

var passPromise, start;

if (program.dbUser === 'e2eTests') {
    passPromise = q('password');
} else {
    var deferred = q.defer();
    passPromise = deferred.promise;
    
    //NOTE: I believe this password prompt only works in commander 1.x
    var promptMsg = util.format('Enter password for %s at %s:%d/%s: ', program.dbUser, program.dbHost, program.dbPort, program.authDb);
    program.password(promptMsg, function(pass) {
        deferred.resolve(pass);
    });
}

passPromise.then(function(dbPass) {
    start = Date.now();
    console.log('Connecting to mongo at', program.dbHost + ':' + program.dbPort, 'as', program.dbUser);
    return mongoUtils.connect(program.dbHost, program.dbPort, program.authDb, program.dbUser, dbPass);
})
.then(function(database) {
    if (program.dbName !== program.authDb) {
        db = database.db(program.dbName);
    } else {
        db = database;
    }

    zipColl = db.collection('zipcodes');
    
    console.log('Getting data from', program.url);
    
    return requestUtils.qRequest('get', {
        url: program.url,
        gzip: true,
        json: true
    });
}).then(function(resp) {
    if (!resp.body || !(resp.body instanceof Array)) {
        return q.reject('Downloaded data is of type ' + typeof data);
    }
    
    data = resp.body;

    console.log(util.format('Downloaded data has %d records', data.length));
    
    return q(zipColl.count());
}).then(function(count) {
    if (count >= data.length && !program.force) {
        console.log(util.format('Found %d records in mongo, not force updating them', count));
        db && db.close();
        process.exit(0);
    }
    
    console.log('Beginning bulk write');
    
    var writeOps = data.map(function(obj) {
        return {
            updateOne: {
                filter: { zipcode: obj.zipcode },
                update: obj,
                upsert: true
            }
        };
    });
    
    return q(zipColl.bulkWrite(writeOps, { w: 1, ordered: false }));
})
.then(function(result) {
    var end = Date.now();
    console.log(util.format('Finished in %d seconds', (end - start) / 1000));
    console.log(util.format('Updated %d records', result.modifiedCount || result.matchedCount));
    console.log(util.format('Inserted %d records', result.insertedCount || result.upsertedCount));
    
    db && db.close();
    process.exit(0);
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    db && db.close();
    process.exit(1);
});
