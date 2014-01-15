var mongodb = require('mongodb'),
    q       = require('q'),
    mongoUtils = {};
    
mongoUtils.connect = function(host, port) {
    var mongoClient = new mongodb.MongoClient(new mongodb.Server(host, port), {native_parser:true});
    return q.npost(mongoClient, 'open');
};


module.exports = mongoUtils;
