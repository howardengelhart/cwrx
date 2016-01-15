#!/usr/bin/env node
var q           = require('q'),
    util        = require('util'),
    path        = require('path'),
    fs          = require('fs-extra'),
    program     = require('commander'),
    requestUtils = require('../lib/requestUtils');

program
    .version('0.0.1')
    .option('-n, --name <name>', 'Name of new referralCode entity (required)')
    .option('-c, --clientId [clientId]', 'clientId for new referralCode entity (optional)')
    .option('-e, --env [staging|production]', 'Environment to send requests to (staging, production)', 'staging')
    .option('--credsFile [/path/to/credentials]', 'Path to JSON credential file with email + password', path.join(process.env.HOME, '.c6prov.json'))
    .option('-l, --local', 'If set, send requests to localhost, authenticating as testuser', false)
    .parse(process.argv);

if (!program.name) {
    console.error('Must provide a name with -n or --name');
    process.exit(1);
}
if (program.env !== 'staging' && program.env !== 'production') {
    console.error('--env must be either \'staging\' or \'production\'');
    process.exit(1);    
}
if (!fs.existsSync(program.credsFile)) {
    console.error('No credentials file at ' + program.credsFile);
    process.exit(1);
}

var creds, baseUrl;

if (program.local) {
    creds = { email: 'testuser', password: 'password' };
    baseUrl = 'http://localhost';
} else {
    creds = fs.readJSONSync(program.credsFile);
    baseUrl = 'https://platform' + (program.env === 'staging' ? '-staging' : '')  + '.reelcontent.com';
}

console.log('Logging in to ', baseUrl);

requestUtils.qRequest('post', {
    url: baseUrl + '/api/auth/login',
    json: { email: creds.email, password: creds.password },
    jar: true
})
.then(function(resp) {
    if (resp.response.statusCode !== 200) {
        return q.reject({ error: 'Failed login', detail: { code: resp.response.statusCode, body: resp.body } });
    }
    
    console.log('Successfully logged in');
    console.log('Creating new referralCode with name', program.name, !!program.clientId ? ('and clientId ' + program.clientId) : '');
    
    return requestUtils.qRequest('post', {
        url: baseUrl + '/api/referral-codes',
        json: { name: program.name, clientId: program.clientId },
        jar: true
    });
})
.then(function(resp) {
    if (resp.response.statusCode !== 201) {
        return q.reject({ error: 'Failed POSTing referralCode', detail: { code: resp.response.statusCode, body: resp.body } });
    }

    console.log('Successfully created new referral code:');
    console.log(resp.body);
    console.log('Signup url with referralCode:');
    console.log(baseUrl + '/#/signup?ref=' + resp.body.code);
    
    return requestUtils.qRequest('post', {
        url: baseUrl + '/api/auth/logout',
        jar: true
    });
})
.catch(function(error) {
    console.error(util.inspect(error));
    process.exit(1);
});
