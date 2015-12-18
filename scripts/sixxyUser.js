#!/usr/bin/env node
var q           = require('q'),
    program     = require('commander'),
    mongoUtils  = require('../lib/mongoUtils');

program
    .version('0.0.1')
    .option('--dbHost [HOST]', 'Host of mongo instance', '33.33.33.100')
    .option('--dbPort [PORT]', 'Port of mongo instance', parseInt, 27017)
    .option('--dbUser [DBUSER]', 'Name of mongo user to use', 'e2eTests')
    .option('--dbPass [DBPASS]', 'Password of mongo user to use', 'password')
    .option('--id [ID]', 'Id of sixxy user', 'u-sixxy')
    .option('-o, --org [ORG]', 'Id of sixxy user\'s org', 'o-test')
    .parse(process.argv);

var db, userColl;

console.log('Connecting to mongo at', program.dbHost, ':', program.dbPort);

mongoUtils.connect(program.dbHost, program.dbPort, 'c6Db', program.dbUser, program.dbPass)
.then(function(database) {
    db = database;
    userColl = db.collection('users');
    
    var user = {
        id: program.id,
        org: program.org,
        created: new Date(),
        lastUpdated: new Date(),
        status: 'active',
        permissions: {
            orgs: { create: 'all' },
            advertisers: { create: 'all' }
        },
        fieldValidation: {
            advertisers: {
                org: { __allowed: true }
            }
        }
    };

    return q.npost(userColl, 'findAndModify', [{ id: program.id}, {id: 1}, mongoUtils.escapeKeys(user),
                                               { w: 1, journal: true, new: true, upsert: true }]);
})
.then(function() {
    console.log('Successfully created/updated user', program.id);
    db && db.close();
    process.exit(0);
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    db && db.close();
    process.exit(1);
});
