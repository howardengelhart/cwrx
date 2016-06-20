#!/usr/bin/env node
var fs              = require('fs-extra'),
    q               = require('q'),
    path            = require('path'),
    request         = require('request'),
    util            = require('util'),
    jsonDiff        = require('jsondiffpatch'),
    requestUtils    = require('../lib/requestUtils'),
    objUtils        = require('../lib/objUtils'),

    creds = fs.readJsonSync(path.join(process.env.HOME, '.c6prov.json')),
    stagJar = request.jar(),
    prodJar = request.jar();

/**
 * Fetches all roles + policies in staging + production, and compares them.
 * Will log if some roles or policies exist in production but not staging (and vice-versa).
 * Will also log a diff for each role + policy that differs from staging to production.
 */
 
q.all([
    requestUtils.qRequest('post', {
        url: 'https://platform-staging.reelcontent.com/api/auth/login',
        json: { email: creds.email, password: creds.password },
        jar: stagJar
    }),
    requestUtils.qRequest('post', {
        url: 'https://platform.reelcontent.com/api/auth/login',
        json: { email: creds.email, password: creds.password },
        jar: prodJar
    })
])
.spread(function(stagResult, prodResult) {
    if (stagResult.response.statusCode !== 200) {
        console.log('failed staging login');
        return q.reject(stagResult);
    }
    if (prodResult.response.statusCode !== 200) {
        console.log('failed production login');
        return q.reject(prodResult);
    }

    return q.all([
        requestUtils.qRequest('get', {
            url: 'https://platform-staging.reelcontent.com/api/account/policies',
            jar: stagJar
        }),
        requestUtils.qRequest('get', {
            url: 'https://platform.reelcontent.com/api/account/policies',
            jar: prodJar
        })
    ]);
})
.spread(function(stagResult, prodResult) {
    if (stagResult.response.statusCode !== 200) {
        console.log('failed to get staging policies');
        return q.reject(stagResult);
    }
    if (prodResult.response.statusCode !== 200) {
        console.log('failed to get production policies');
        return q.reject(prodResult);
    }
    
    var stagPols = stagResult.body, prodPols = prodResult.body;
    
    if (stagPols.length !== prodPols.length) {
        console.log(stagPols.length + ' policies in staging but ' + prodPols.length + ' policies in production');
    }
    
    stagPols.forEach(function(stagPol) {
        var matching = prodPols.filter(function(prodPol) {
            return prodPol.name === stagPol.name;
        })[0];
        if (!matching) {
            console.log('Policy ' + stagPol.name + ' does not exist in prod');
            return;
        }
        if (!objUtils.compareObjects(matching.permissions, stagPol.permissions)) {
            console.log('Policy ' + stagPol.name + ' differs in permissions: ');
            console.log(jsonDiff.formatters.console.format(jsonDiff.diff(matching.permissions, stagPol.permissions)));
            console.log('--------------------------------------------------');
        }
        if (!objUtils.compareObjects(matching.fieldValidation, stagPol.fieldValidation)) {
            console.log('Policy ' + stagPol.name + ' differs in fieldValidation: ');
            console.log(jsonDiff.formatters.console.format(jsonDiff.diff(matching.fieldValidation, stagPol.fieldValidation)));
            console.log('--------------------------------------------------');
        }
        if (!objUtils.compareObjects(matching.entitlements, stagPol.entitlements)) {
            console.log('Policy ' + stagPol.name + ' differs in entitlements: ');
            console.log(jsonDiff.formatters.console.format(jsonDiff.diff(matching.entitlements, stagPol.entitlements)));
            console.log('--------------------------------------------------');
        }
        if ((stagPol.applications || []).length !== (matching.applications || []).length) {
            console.log('Policy ' + stagPol.name + ' differs in applications: ');
            console.log(jsonDiff.formatters.console.format(jsonDiff.diff(matching.applications, stagPol.applications)));
            console.log('--------------------------------------------------');
        }
    });
    console.log('Successfully examined all policies');
    
    return q.all([
        requestUtils.qRequest('get', {
            url: 'https://platform-staging.reelcontent.com/api/account/roles',
            jar: stagJar
        }),
        requestUtils.qRequest('get', {
            url: 'https://platform.reelcontent.com/api/account/roles',
            jar: prodJar
        })
    ]);
})
.spread(function(stagResult, prodResult) {
    if (stagResult.response.statusCode !== 200) {
        console.log('failed to get staging roles');
        return q.reject(stagResult);
    }
    if (prodResult.response.statusCode !== 200) {
        console.log('failed to get production roles');
        return q.reject(prodResult);
    }

    var stagRoles = stagResult.body, prodRoles = prodResult.body;

    stagRoles.forEach(function(stagRole) {
        var matching = prodRoles.filter(function(prodRole) {
            return prodRole.name === stagRole.name;
        })[0];
        if (!matching) {
            console.log('Role ' + stagRole.name + ' does not exist in prod');
            return;
        }
        
        stagRole.policies.sort();
        matching.policies.sort();
        
        if (!objUtils.compareObjects(matching.policies, stagRole.policies)) {
            console.log('Role ' + stagRole.name + ' differs in policies: ');
            console.log(jsonDiff.formatters.console.format(jsonDiff.diff(matching.policies, stagRole.policies)));
            console.log('--------------------------------------------------');
        }
    });
    console.log('Successfully examined all roles');
    
    return q.all([
        requestUtils.qRequest('post', {
            url: 'https://platform-staging.reelcontent.com/api/auth/logout',
            jar: stagJar
        }),
        requestUtils.qRequest('post', {
            url: 'https://platform.reelcontent.com/api/auth/logout',
            jar: prodJar
        })
    ]);
}).catch(function(error) {
    console.log('Got an error:');
    console.log(util.inspect(error));
});
