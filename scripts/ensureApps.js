#!/usr/bin/env node
var q           = require('q'),
    program     = require('commander'),
    mongoUtils  = require('../lib/mongoUtils');

var apps = [
    {
        id: 'app-adsservice',
        created: new Date(),
        lastUpdates: new Date(),
        status: 'active',
        key: '_internal-ads-service',
        secret: '4cd371bf665c20f4fc1f0f4d9a1db851a28cfeec',
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
