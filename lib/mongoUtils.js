var mongodb = require('mongodb'),
    q       = require('q'),
    mongoUtils = {};
    
mongoUtils.connect = function(host, port) {
    var mongoClient = new mongodb.MongoClient(new mongodb.Server(host, port), {native_parser:true});
    return q.npost(mongoClient, 'open');
};

// Return a copy of the user object with sensitive fields removed, safe for sending to the client
// This should be updated any time code is added that will add sensitive properties to the user object
mongoUtils.safeUser = function(user) {
    var newUser = {};
    for (var key in user) {
        if (key !== 'password') {
            newUser[key] = user[key];
        }
    }
    return newUser;
};

module.exports = mongoUtils;
