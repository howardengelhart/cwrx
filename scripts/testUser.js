#!/usr/bin/env node
var q           = require('q'),
    program     = require('commander'),
    mongoUtils  = require('../lib/mongoUtils'),

    hashPass = '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of password    
    allEntities = [
        'advertisers',
        'campaigns',
        'cards',
        'categories',
        'customers',
        'elections',
        'experiences',
        'minireelGroups',
        'orgs',
        'policies',
        'roles',
        'sites',
        'users'
    ];

// setup permissive fieldValidation rules for users + policies on the policy
function setupUserSvcFieldVal(policy) {
    policy.fieldValidation.users = {
        policies: {
            __allowed: true,
            __entries: {
                __acceptableValues: '*'
            }
        },
        roles: {
            __allowed: true,
            __entries: {
                __acceptableValues: '*'
            }
        }
    };
    
    policy.fieldValidation.policies = {
        applications: {
            __allowed: true,
            __entries: {
                __acceptableValues: '*'
            }
        },
        permissions: allEntities.reduce(function(permValObj, entity) {
            permValObj[entity] = {
                __allowed: true
            };
            
            return permValObj;
        }, {}),
        fieldValidation: allEntities.reduce(function(fieldValObj, entity) {
            fieldValObj[entity] = {
                __allowed: true
            };
            
            return fieldValObj;
        }, {}),
        entitlements: {
            __allowed: true
        }
    };
}
    
program
    .version('0.0.1')
    .option('--dbHost [HOST]', 'Host of mongo instance', '33.33.33.100')
    .option('--dbPort [PORT]', 'Port of mongo instance', parseInt, 27017)
    .option('--dbUser [DBUSER]', 'Name of mongo user to use', 'e2eTests')
    .option('--dbPass [DBPASS]', 'Password of mongo user to use', 'password')
    .option('-i, --id [ID]', 'New user\'s id property', 'u-test')
    .option('-e, --email [EMAIL]', 'Email of test user', 'testuser')
    .option('-o, --org [ORG]', 'Id of test user\'s org', 'o-test')
    .option('-p, --perms [PERMS]', 'List of object names to give user permissions for', 'all')
    .parse(process.argv);

var db, userColl;

program.email = program.email.toLowerCase();

console.log('Connecting to mongo at', program.dbHost, ':', program.dbPort);

mongoUtils.connect(program.dbHost, program.dbPort, 'c6Db', program.dbUser, program.dbPass)
.then(function(database) {
    db = database;
    userColl = db.collection('users');
    
    return q.npost(userColl, 'findOne', [{ $or: [{id: program.id}, {email: program.email}] }])
    .then(function(existing) {
        if (existing) {
            throw new Error('A user already exists with id ' + program.id + ' or email ' + program.email);
        }
        
        console.log('Creating user', program.id, 'with email', program.email, 'and password "password"');
        
        var userPerms = program.perms === 'all' ? allEntities : program.perms.split(',').filter(function(objName) {
            return allEntities.some(function(perm) { return perm === objName; });
        });
        
        console.log('New user will have full admin priviledges over:', userPerms.join(','));
        
        var policy = {
            id: 'p-testAdmin',
            name: 'testFullAdmin',
            created: new Date(),
            lastUpdated: new Date(),
            status: 'active',
            permissions: {},
            fieldValidation: {}
        };
        
        userPerms.forEach(function(key) {
            policy.permissions[key] = { read: 'all', create: 'all', edit: 'all', delete: 'all' };
        });
        
        setupUserSvcFieldVal(policy);

        return q.npost(db.collection('policies'), 'findAndModify', [{id: 'p-testAdmin'}, {id: 1}, policy,
                                                                    {w: 1, journal: true, new: true, upsert: true}]);
    }).then(function(policy) {
        console.log('Created/updated policy p-testAdmin');
        
        var newUser = {
            id: program.id,
            created: new Date(),
            lastUpdated: new Date(),
            email: program.email,
            password: hashPass,
            status: 'active',
            policies: ['testFullAdmin']
        };
        
        return q.npost(userColl, 'insert', [mongoUtils.escapeKeys(newUser), {w: 1, journal: true}]);
    })
    .then(function() {
        console.log('Successfully created user', program.id);
    });
})
.catch(function(error) {
    console.log('Got an error: ');
    console.log(error);
})
.finally(function() {
    db && db.close();
});
