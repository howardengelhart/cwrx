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
    .option('-o, --org [ORG]', 'Id of test user\'s org', 'o-test')
    .parse(process.argv);

program.id = 'u-sixxy';

var db, userColl;

console.log('Connecting to mongo at', program.dbHost, ':', program.dbPort);

mongoUtils.connect(program.dbHost, program.dbPort, 'c6Db', program.dbUser, program.dbPass)
.then(function(database) {
    db = database;
    userColl = db.collection('users');

    return q.npost(userColl, 'findOne', [{ $or: [{id: program.id}, {email: 'sixxy'}] }])
    .then(function(policy) {
        var newUser = {
            id: program.id,
            org: 'o-test',
            created: new Date(),
            lastUpdated: new Date(),
            status: 'active',
            permissions: {
                orgs: { create: 'all' },
                customers: { create: 'all' },
                advertisers: { create: 'all' }
            }
        };

        return q.npost(userColl, 'findAndModify', [{ id: program.id}, {id: 1}, mongoUtils.escapeKeys(newUser),
                                                   { w: 1, journal: true, new: true, upsert: true }]);
    })
    .then(function() {
        console.log('Successfully created/updated user', program.id);
    });
})
.then(function() {
    db && db.close();
    process.exit(0);
})
.catch(function(error) {
    console.error('Got an error: ');
    console.error(error);
    db && db.close();
    process.exit(1);
});
