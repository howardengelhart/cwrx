var fs      = require('fs'),
    request = require('request'),
    q       = require('q'),

    server = 'https://33.33.33.10',
    username = 'querybot',
    password = 'password',
    authUrl   = server + '/api/auth/login',
    queryUrl  = server + '/api/analytics/campaigns';

function authenticate() {
    if ((username === null) || (password === null)) {
        return q.reject('username and password required.');
    }

    var loginOpts = {
        url: authUrl,
        rejectUnauthorized : false,
        json: {
            email       : username,
            password    : password
        },
        jar : true
    }, deferred = q.defer();
   
    request.post(loginOpts, function(error, response, body) {
        if (error) {
            console.log('Login error: ', error);
            return deferred.reject(error);
        }
        else if (response.statusCode !== 200) {
            console.log('Login failure: ', response.statusCode);
            console.log(body);
            return deferred.reject(body);
        }
        
        return deferred.resolve();
    });

    return deferred.promise;
}

function getData() {
    
    var opts = {
        //url: queryUrl + '/?ids=cam-5bebbf1c34a3d7,cam-bfc62ac554280e,x',
        url: queryUrl + '/cam-1757d5cd13e383?startDate=2015-12-02&endDate=2015-12-03',
        rejectUnauthorized : false,
        jar : true
    }, deferred = q.defer();
   
    request.get(opts, function(error, response, body) {
        if (error) {
            console.log(' Error: ', error);
            return deferred.reject(error);
        }
        else if (response.statusCode !== 200) {
            console.log(' Failed: ', response.statusCode);
            console.log(body);
            return deferred.reject(body);
        }
        
        return deferred.resolve(body);
    });
    
    return deferred.promise;
}

authenticate()
.then(getData)
.then(function(data){
    console.log('data:',data);
});
