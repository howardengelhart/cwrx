#!/usr/bin/env node
var q           = require('q'),
    program     = require('commander'),
    mongoUtils  = require('../lib/mongoUtils'),

    hashPass = '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of password    
    allEntities = [
        'advertisers',
        'campaigns',
        'campaignUpdates',
        'cards',
        'categories',
        'containers',
        'elections',
        'experiences',
        'minireelGroups',
        'orgs',
        'placements',
        'policies',
        'referralCodes',
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

// setup permissive fieldValidation rules for orgs on the policy
function setupOrgSvcFieldVal(policy) {
    policy.fieldValidation.orgs = {
        adConfig: {
            __allowed: true
        },
        braintreeCustomer: {
            __allowed: true
        }
    };
}

// setup permissive fieldValidation rules for campaigns
function setupCampaignSvcFieldVal(policy) {
    policy.fieldValidation.campaigns = {
        status: {
            __allowed: true
        },
        application: {
            __allowed: true
        },
        staticCardMap: {
            __allowed: true
        },
        minViewTime: {
            __allowed: true
        },
        pricing: {
            budget: {
                __min: 0,
                __max: 9999999999
            },
            dailyLimit: {
                __percentMin: 0,
                __percentMax: 1
            },
            model: {
                __allowed: true
            },
            cost: {
                __allowed: true
            }
        },
        cards: {
            __length: 100
        },
        miniReels: {
            __allowed: true
        }
    };
    policy.fieldValidation.campaignUpdates = {
        status: {
            __allowed: true
        },
        rejectionReason: {
            __allowed: true
        }
    };
    policy.entitlements.adminCampaigns = true;
    policy.entitlements.directEditCampaigns = true;
    policy.entitlements.paymentOptional = true;
}

// setup permissive fieldValidation rules for cards, etc.
function setupContentSvcFieldVal(policy) {
    policy.fieldValidation.cards = {
        user: {
            __allowed: true
        },
        org: {
            __allowed: true
        },
        campaign: {
            minViewTime: {
                __allowed: true
            }
        },
        data: {
            skip: {
                __allowed: true
            },
            controls: {
                __allowed: true
            },
            autoplay: {
                __allowed: true
            },
            autoadvance: {
                __allowed: true
            }
        }
    };
    policy.entitlements.directEditCampaigns = true;
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
    
    console.log('Creating/updating user', program.id, 'with email', program.email, 'and password "password"');
    
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
        fieldValidation: {},
        entitlements: {}
    };
    
    userPerms.forEach(function(key) {
        policy.permissions[key] = { read: 'all', create: 'all', edit: 'all', delete: 'all' };
    });
    
    setupUserSvcFieldVal(policy);
    setupOrgSvcFieldVal(policy);
    setupCampaignSvcFieldVal(policy);

    return q(db.collection('policies').findOneAndUpdate(
        { id: 'p-testAdmin' },
        policy,
        { w: 1, journal: true, returnOriginal: false, upsert: true, sort: { id: 1 } }
    ));
}).then(function(policy) {
    console.log('Created/updated policy p-testAdmin');
    
    var newUser = {
        id: program.id,
        org: 'o-test',
        created: new Date(),
        lastUpdated: new Date(),
        email: program.email,
        password: hashPass,
        status: 'active',
        policies: ['testFullAdmin'],
        applications : ['e-selfie', 'e-studio'],
        config: {
            minireelinator : {
                minireelDefaults : {
                    splash : {
                        ratio : '6-5',
                        theme : 'img-only'
                    }
                }
            }
        }
    };

    return q(userColl.findOneAndUpdate(
        { id: program.id },
        mongoUtils.escapeKeys(newUser),
        { w: 1, journal: true, returnOriginal: false, upsert: true, sort: { id: 1 } }
    ));
})
.then(function() {
    console.log('Successfully created/updated user', program.id);
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
