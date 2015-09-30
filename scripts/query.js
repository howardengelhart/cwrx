var server = 'https://33.33.33.10',
    username = 'testuser',
    password = 'password',
    authUrl   = server + '/api/auth/login',
    queryUrl  = server + '/api/analytics/campaigns',
    authCookie = null; // will be set by authenticate method

/* 
 * Helper NPM Modules 
 * */
var fs      = require('fs'),
    request = require('request'),
    q       = require('q');

/* 
 * Logins in, returns cookie used for authenticated methods 
 * */
function authenticate() {

    if ((username === null) || (password === null)) {
        return q.reject('You must set the username and password variables at the top of this script.');
    }

    var loginOpts = {
        url: authUrl,
        rejectUnauthorized : false,
        json: {
            email       : username,
            password    : password
        }
    }, deferred = q.defer();
   
    console.log('Authenticate with the api server.');
    request.post(loginOpts, function(error, response, body) {
        if (error) {
            console.log('Login error: ', error);
            return deferred.reject(error);
        }
        else if (response.statusCode !== 200) { // 200 on success; 400 on bad request; 401 on wrong email/pass
            console.log('Login failure: ', response.statusCode);
            console.log(body);
            return deferred.reject(body);
        }
        
        console.log('Successful login');
        
        // Successful login sets cookie named "c6Auth", which must be included on subsequent requests
        authCookie = response.headers['set-cookie'][0].match(/c6Auth=[^\s]+/)[0];
        return deferred.resolve(authCookie);
    });

    return deferred.promise;
}

function getData() {
    
    var opts = {
        url: queryUrl + '/?id=ABC,DEF',
        rejectUnauthorized : false,
        headers: {
            'Cookie': authCookie
        }
    }, deferred = q.defer();
   
    request.get(opts, function(error, response, body) {
        if (error) {
            console.log(' Error: ', error);
            return deferred.reject(error);
        }
        else if (response.statusCode !== 200) { // 200 on success; 400 on bad request; 401 on unauthorized
            console.log(' Failed: ', response.statusCode);
            console.log(body);
            return deferred.reject(body);
        }
        
        console.log(' Success!');
        return deferred.resolve(body);
    });
    
    return deferred.promise;
}

authenticate()
.then(getData)
.then(function(data){
    console.log('data:',data);

});
