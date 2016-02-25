#!/usr/bin/env node
var q           = require('q'),
    program     = require('commander'),
    mongoUtils  = require('../lib/mongoUtils');

var apps = [
    {
        id: 'app-cwrx',
        created: new Date(),
        lastUpdated: new Date(),
        _preserve: true, // testUtils.resetCollection will not delete objects with this flag
        status: 'active',
        key: 'cwrx-services',
        secret: 'ade2cfd7ec2e71d54064fb8cfb1cc92be1d01ffd',
        permissions: {
            orgs: { create: 'all' },
            advertisers: { create: 'all' }
        },
        fieldValidation: {
            advertisers: {
                org: { __allowed: true }
            },
            orgs: {
                referralCode: { __allowed: true }
            }
        },
        entitlements: {
            directEditCampaigns: true
        }
    }
];

program
    .version('0.0.1')
    .option('--dbHost [HOST]', 'Host of mongo instance', '33.33.33.100')
    .option('--dbPort [PORT]', 'Port of mongo instance', parseInt, 27017)
    .option('--dbUser [DBUSER]', 'Name of mongo user to use', 'e2eTests')
    .option('--dbPass [DBPASS]', 'Password of mongo user to use', 'password')
    .parse(process.argv);

var db, userColl;

console.log('Connecting to mongo at', program.dbHost, ':', program.dbPort);

mongoUtils.connect(program.dbHost, program.dbPort, 'c6Db', program.dbUser, program.dbPass)
.then(function(database) {
    db = database;
    appColl = db.collection('applications');
    
    return q.all(apps.map(function(app) {
        return q(appColl.findOneAndUpdate(
            { id: app.id },
            mongoUtils.escapeKeys(app),
            { w: 1, journal: true, returnOriginal: false, upsert: true, sort: { id: 1 } }
        ))
        .then(function() {
            console.log('Successfully created/updated app', app.id);
        });
    }));
})
.then(function() {
    console.log('Successfully created/updated all applications');
    db && db.close();
    process.exit(0);
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    db && db.close();
    process.exit(1);
});
