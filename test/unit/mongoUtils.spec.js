var flush = true;    
describe('mongoUtils', function() {
    var mongodb, mongoUtils, q, events, logger, mockLog;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        mongodb     = require('mongodb');
        mongoUtils  = require('../../lib/mongoUtils');
        logger      = require('../../lib/logger');
        events      = require('events');
        q           = require('q');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
    });
    
    describe('connect', function() {
        var fakeDb;
        beforeEach(function() {
            fakeDb = new events.EventEmitter();
            spyOn(mongodb.MongoClient, 'connect').andCallFake(function(url, opts, cb) {
                cb(null, fakeDb);
            });
            spyOn(process, 'exit');
        });
        
        it('should correctly setup the client and connect', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb').then(function(db) {
                expect(db).toBe(fakeDb);
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
                expect(db).toBe(fakeDb);
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
                expect(db).toBe(fakeDb);
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
        /*
        it('should create a db that responds to close events', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb')
            .then(function(db) {
                expect(db).toBe(fakeDb);
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                db.emit('close');
                expect(mockLog.error).toHaveBeenCalled();
                expect(process.exit).toHaveBeenCalledWith(1);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should create a db that responds to error events', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb')
            .then(function(db) {
                expect(db).toBe(fakeDb);
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                db.emit('error', 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(process.exit).toHaveBeenCalledWith(1);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        */
    });
    
    describe('safe user', function() {
        beforeEach(function() {
            spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        });

        it('should create a new user object without any sensitive fields', function() {
            var user = {
                _id: "thisisamongo_id",
                email: 'johnnyTestmonkey',
                password: 'hashofasecret'
            };
            var newUser = mongoUtils.safeUser(user);
            expect(newUser.email).toBe('johnnyTestmonkey');
            expect(newUser._id).not.toBeDefined();
            expect(newUser.password).not.toBeDefined();
            // shouldn't edit existing user object
            expect(user._id).toBe('thisisamongo_id');
            expect(user.email).toBe('johnnyTestmonkey');
            expect(user.password).toBe('hashofasecret');
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });
    });
    
    describe('escapeKeys', function() {
        var eD = String.fromCharCode(65284),
            eP = String.fromCharCode(65294);

        it('should properly escape keys where necessary', function() {
            var obj = {
                'foo': 'bar', '$set': 'someprops', 'a$set': 'isgood', 'a.b.c': 'd.e.f',
                '$nested': { '$foo.bar': 'fubar' }
            };
            var newObj = mongoUtils.escapeKeys(obj);
            expect(newObj).not.toBe(obj);
            expect(Object.keys(newObj)).toEqual(['foo', eD + 'set', 'a$set',
                                                 'a' + eP + 'b' + eP + 'c', eD + 'nested']);
            expect(newObj.foo).toBe('bar');
            expect(newObj[eD + 'set']).toBe('someprops');
            expect(newObj['a' + eP + 'b' + eP + 'c']).toBe('d.e.f');
            expect(Object.keys(newObj[eD + 'nested'])).toEqual([eD + 'foo' + eP + 'bar']);
            expect(newObj[eD + 'nested'][eD + 'foo' + eP + 'bar']).toBe('fubar');
        });
        
        it('should handle arrays properly', function() {
            var obj = [ {foo: 'bar'}, {'$set': 'prop'} ],
                newObj = mongoUtils.escapeKeys(obj);
            expect(newObj instanceof Array).toBeTruthy();
            expect(newObj.length).toBe(2);
            expect(newObj[0]).toEqual({foo: 'bar'});
            expect(newObj[1][eD + 'set']).toBe('prop');
        });
        
        it('should leave dates alone', function() {
            var start = new Date();
            expect(mongoUtils.escapeKeys({ created: start })).toEqual({ created: start });
        });
    });
    
    describe('unescapeKeys', function() {
        var eD = String.fromCharCode(65284),
            eP = String.fromCharCode(65294);

        it('should restore escaped keys to original values', function() {
            var obj = {
                'foo': 'bar', '$set': 'someprops'
            };
            obj[eD + 'thang'] = 'yes';
            obj['this' + eP + 'that'] = { yorp: 'yurp' };
            expect(mongoUtils.unescapeKeys(obj)).toEqual({
                foo: 'bar', '$set': 'someprops', '$thang': 'yes', 'this.that': { yorp: 'yurp' }
            });
        });
        
        it('should exactly reverse the changes of escapeKeys', function() {
            var obj = {
                'foo': 'bar', '$set': 'someprops', 'a$set': 'isgood', 'a.b.c': 'd.e.f',
                '$nested': { '$foo.bar': 'fubar' }, arr: [{'$foo': 'bar'},{'a.b': 'b.c'},{'a': 'b'}]
            };
            var escObj = mongoUtils.escapeKeys(obj),
                newObj = mongoUtils.unescapeKeys(escObj);

            expect(newObj).not.toBe(obj);
            expect(newObj).toEqual(obj);
            expect(escObj).not.toEqual(obj);
        });

        it('should leave dates alone', function() {
            var start = new Date();
            expect(mongoUtils.unescapeKeys({ created: start })).toEqual({ created: start });
        });

        it('should handle arrays properly', function() {
            var obj = [ {foo: 'bar'}, {} ];
            obj[1][eD + 'set'] = 'prop';
            expect(mongoUtils.unescapeKeys(obj)).toEqual([ {foo: 'bar'}, {'$set': 'prop'} ]);
        });
    });
});
