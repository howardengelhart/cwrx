#!/usr/bin/env node
var q               = require('q'),
    util            = require('util'),
    program         = require('commander'),
    mongoUtils      = require('../lib/mongoUtils'),
    requestUtils    = require('../lib/requestUtils'),
    Status          = require('../lib/enums').Status;

program
    .version('0.0.1')
    .option('--dbName [DBNAME]', 'Name of db to write to', 'c6Db')
    .option('--authDb [AUTHDB]', 'Name of db to authenticate to', 'c6Db')
    .option('--dbHost [HOST]', 'Host of mongo instance', '33.33.33.100')
    .option('--dbPort [PORT]', 'Port of mongo instance', parseInt, 27017)
    .option('--dbUser [DBUSER]', 'Name of mongo user to use', 'e2eTests')
    .option('-p, --promotion [PROMOTION_ID]', 'Id of promotion to apply')
    .option('-a, --amount [AMOUNT]', 'Dollar amount of credit to give', parseFloat)
    .option('-o, --org [ORG_ID]', 'Id of org to give credit to')
    .option('-e, --env [staging|production|local]', 'Environment to send requests to (staging, production, local)', 'staging')
    .option('--noSaveToOrg [SAVE_TO_ORG]', 'If set, do NOT add entry to org.promotions')
    .parse(process.argv);

var db, passPromise, baseUrl;

['promotion', 'amount', 'org'].forEach(function(param) {
    if (!program[param]) {
        console.log('Must pass', param, 'parameter');
        process.exit(1);
    }
});

if (program.env === 'local') {
    baseUrl = 'http://localhost';
} else {
    baseUrl = 'https://platform' + (program.env === 'staging' ? '-staging' : '')  + '.reelcontent.com';
}

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
    console.log('Connecting to mongo at', program.dbHost + ':' + program.dbPort, 'as', program.dbUser);
    return mongoUtils.connect(program.dbHost, program.dbPort, program.authDb, program.dbUser, dbPass);
})
.then(function(database) {
    if (program.dbName !== program.authDb) {
        db = database.db(program.dbName);
    } else {
        db = database;
    }
    
    return mongoUtils.findObject(db.collection('applications'), { key: 'watchman-app' });
})
.then(function(app) {
    if (!app) {
        return q.reject('Watchman app not found');
    }
    var appCreds = {
        key: app.key,
        secret: app.secret
    };
    
    console.log(util.format('Creating new transaction for org %s for $%d tied to %s',
                            program.org, program.amount, program.promotion));
    
    return requestUtils.makeSignedRequest(appCreds, 'post', {
        url: baseUrl + '/api/transactions/',
        json: {
            org         : program.org,
            amount      : program.amount,
            promotion   : program.promotion
        }
    });
})
.then(function(transResp) {
    if (transResp.response.statusCode !== 201) {
        return q.reject('Failed POSTing transaction: ' + util.inspect({
            code: transResp.response.statusCode,
            body: transResp.body
        }));
    }
    console.log(util.format('Created transaction %s for org %s', transResp.body.id, program.org));
    
    if (!!program.noSaveToOrg) {
        return q();
    }
    
    console.log(util.format('Adding entry for %s to promotions array of org %s', program.promotion, program.org));
    
    return q(db.collection('orgs').findOneAndUpdate(
        { id: program.org },
        {
            $addToSet: { promotions: {
                id: program.promotion,
                status: Status.Active,
                created: new Date(),
                lastUpdated: new Date()
            } }
        },
        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
    ));
})
.then(function() {
    console.log(util.format('Finished applying %s to org %s', program.promotion, program.org));
    db && db.close();
    process.exit(0);
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    db && db.close();
    process.exit(1);
});
