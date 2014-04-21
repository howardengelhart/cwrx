var flush = true;    
describe('mongoUtils', function() {
    var mongodb, mongoUtils, q;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        mongodb     = require('mongodb');
        mongoUtils  = require('../../lib/mongoUtils');
        q           = require('q');
    });
    
    describe('connect', function() {
        beforeEach(function() {
            spyOn(mongodb.MongoClient, 'connect').andCallFake(function(url, opts, cb) {
                cb(null, 'fakeDb');
            });
        });
        
        it('should correctly setup the client and connect', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb').then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls[0].args[0]).toBe('mongodb://10.0.0.1:666/fakeDb');
                expect(mongodb.MongoClient.connect.calls[0].args[1]).toEqual({
                    server: { auto_reconnect: true },
                    db: { native_parser: true, bufferMaxEntries: 0 }
                });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to connect to multiple hosts', function(done) {
            var hosts = [ '10.0.1.1:123', '10.0.1.2:456' ];
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb', null, null, hosts, 'devReplSet')
            .then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls[0].args[0])
                    .toBe('mongodb://10.0.1.1:123,10.0.1.2:456/fakeDb?replicaSet=devReplSet');
                expect(mongodb.MongoClient.connect.calls[0].args[1]).toEqual({
                    server: { auto_reconnect: true },
                    db: { native_parser: true, bufferMaxEntries: 0 }
                });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should include auth params if passed to the function', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb', 'test', 'password')
            .then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls[0].args[0])
                    .toBe('mongodb://test:password@10.0.0.1:666/fakeDb');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if the required params are not provided', function(done) {
            q.allSettled([
                mongoUtils.connect('host', 'port', null, 'user', 'pass', ['host:port'], 'replSet'),
                mongoUtils.connect('host', null, 'db', 'user', 'pass', ['host:port'], null),
                mongoUtils.connect(null, 'port', 'db', 'user', 'pass', null, 'replSet'),
            ]).then(function(results) {
                results.forEach(function(result) {
                    expect(result.state).toBe('rejected');
                    expect(result.reason).toBe('Must pass db and either host+port or hosts+replSet');
                });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should pass along errors from connecting', function(done) {
            mongodb.MongoClient.connect.andCallFake(function(url, opts, cb) {
                cb('Error!');
            });
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb').catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongodb.MongoClient.connect.calls[0].args[0]).toBe('mongodb://10.0.0.1:666/fakeDb');
                done();
            });
        });
    });
    
    describe('safe user', function() {
        it('should create a new user object without any sensitive fields', function() {
            var user = {
                username: 'johnnyTestmonkey',
                password: 'hashofasecret'
            };
            var newUser = mongoUtils.safeUser(user);
            expect(newUser.username).toBe('johnnyTestmonkey');
            expect(newUser.password).not.toBeDefined();
            // shouldn't edit existing user object
            expect(user.username).toBe('johnnyTestmonkey');
            expect(user.password).toBe('hashofasecret');
        });
    });
});
