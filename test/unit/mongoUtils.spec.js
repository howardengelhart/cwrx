var flush = true;
describe('mongoUtils', function() {
    var mongodb, mongoUtils, q, logger, mockLog;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        mongodb     = require('mongodb');
        mongoUtils  = require('../../lib/mongoUtils');
        logger      = require('../../lib/logger');
        q           = require('q');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
    });

    describe('connect', function() {
        beforeEach(function() {
            spyOn(mongodb.MongoClient, 'connect').and.returnValue(q('fakeDb'));
        });

        it('should correctly setup the client and connect', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb').then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls.all()[0].args[0])
                    .toBe('mongodb://10.0.0.1:666/fakeDb?readPreference=primaryPreferred');
                expect(mongodb.MongoClient.connect.calls.all()[0].args[1]).toEqual({
                    server: { autoReconnect: true },
                    db: { bufferMaxEntries: 0 }
                });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should be able to handle an empty hosts array', function(done) {
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb', null, null, [], '')
            .then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls.all()[0].args[0])
                    .toBe('mongodb://10.0.0.1:666/fakeDb?readPreference=primaryPreferred');
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
                expect(mongodb.MongoClient.connect.calls.all()[0].args[0])
                    .toBe('mongodb://10.0.1.1:123,10.0.1.2:456/fakeDb?readPreference=primaryPreferred&replicaSet=devReplSet');
                expect(mongodb.MongoClient.connect.calls.all()[0].args[1]).toEqual({
                    server: { autoReconnect: true },
                    db: { bufferMaxEntries: 0 }
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
                expect(mongodb.MongoClient.connect.calls.all()[0].args[0])
                    .toBe('mongodb://test:password@10.0.0.1:666/fakeDb?readPreference=primaryPreferred');
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
            mongodb.MongoClient.connect.and.returnValue(q.reject('Error!'));
            mongoUtils.connect('10.0.0.1', '666', 'fakeDb').catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongodb.MongoClient.connect.calls.all()[0].args[0])
                    .toBe('mongodb://10.0.0.1:666/fakeDb?readPreference=primaryPreferred');
                done();
            });
        });
    });

    describe('safeUser', function() {
        beforeEach(function() {
            spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        });

        it('should create a new user object without any sensitive fields', function() {
            var user = {
                _id: 'thisisamongo_id',
                email: 'johnnyTestmonkey',
                resetToken: { token: 'hashToken', expires: new Date() },
                password: 'hashofasecret',
                activationToken: {
                    token: 'token',
                    expires: new Date()
                }
            };
            var newUser = mongoUtils.safeUser(user);
            expect(newUser.email).toBe('johnnyTestmonkey');
            expect(newUser._id).not.toBeDefined();
            expect(newUser.password).not.toBeDefined();
            expect(newUser.activationToken).not.toBeDefined();
            expect(newUser.resetToken).not.toBeDefined();
            // shouldn't edit existing user object
            expect(user._id).toBe('thisisamongo_id');
            expect(user.email).toBe('johnnyTestmonkey');
            expect(user.password).toBe('hashofasecret');
            expect(user.resetToken).toEqual({token: 'hashToken', expires: jasmine.any(Date)});
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });

        it('should just return the user if the user is not a proper object', function() {
            expect(mongoUtils.safeUser(null)).toBe(null);
            expect(mongoUtils.safeUser(undefined)).toBe(undefined);
            expect(mongoUtils.safeUser('fake')).toBe('fake');
        });
    });

    describe('safeApplication', function() {
        beforeEach(function() {
            spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        });

        it('should create a new user object without any sensitive fields', function() {
            var app = {
                _id: 'thisisamongo_id',
                id: 'app-1',
                key: 'app 1',
                secret: 'supersecret'
            };
            var newApp = mongoUtils.safeApplication(app);
            expect(newApp).toEqual({
                id: 'app-1',
                key: 'app 1'
            });

            // shouldn't edit existing user object
            expect(app).toEqual({
                _id: 'thisisamongo_id',
                id: 'app-1',
                key: 'app 1',
                secret: 'supersecret'
            });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });

        it('should just return the app if the app is not a proper object', function() {
            expect(mongoUtils.safeApplication(null)).toBe(null);
            expect(mongoUtils.safeApplication(undefined)).toBe(undefined);
            expect(mongoUtils.safeApplication('fake')).toBe('fake');
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

        it('should trim out keys whose value is set as undefined', function() {
            var fmt = mongoUtils.escapeKeys({foo: 'bar', blah: undefined});
            expect(fmt).toEqual({foo: 'bar'});
            expect(Object.keys(fmt)).toEqual(['foo']);
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
    
    describe('mergeORQuery', function() {
        var orClause, query;
        beforeEach(function() {
            query = { user: 'me' };
            orClause = { $or: [ { a: 1 }, { b: 2 } ] };
        });

        it('should just set the $or operator if the query has no previous $and or $or operators', function() {
            mongoUtils.mergeORQuery(query, orClause);
            expect(query).toEqual({
                user: 'me',
                $or: [ { a: 1 }, { b: 2 } ]
            });
        });

        it('should convert the query to use an $and operator if the query has an existing $or operator', function() {
            query.$or = [{ c: 3 }, { d: 4 }];
            mongoUtils.mergeORQuery(query, orClause);
            expect(query).toEqual({
                user: 'me',
                $and: [
                    { $or: [ { c: 3 }, { d: 4 } ] },
                    { $or: [ { a: 1 }, { b: 2 } ] }
                ]
            });
        });

        it('should append the new clause if the query has an $and operator', function() {
            query.$and = [ { $or: [{ c: 3 }, { d: 4 }] }, { $or: [{ e: 5 }, { f: 6 }] } ];
            mongoUtils.mergeORQuery(query, orClause);
            expect(query).toEqual({
                user: 'me',
                $and: [
                    { $or: [ { c: 3 }, { d: 4 } ] },
                    { $or: [ { e: 5 }, { f: 6 } ] },
                    { $or: [ { a: 1 }, { b: 2 } ] }
                ]
            });
        });
    });
    
    describe('findObject', function() {
        var mockColl, mockCursor;
        beforeEach(function() {
            mockCursor = {
                next: jasmine.createSpy('cursor.next()').and.returnValue(q({ thing: 'yes' }))
            };
            mockColl = {
                find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor)
            };
        });
        
        it('should call coll.find() and return the first result from the cursor', function(done) {
            mongoUtils.findObject(mockColl, { foo: 'bar', status: 'active' }).then(function(resp) {
                expect(resp).toEqual({ thing: 'yes' });
                expect(mockColl.find).toHaveBeenCalledWith({ foo: 'bar', status: 'active' }, { limit: 1 });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass along errors', function(done) {
            mockCursor.next.and.returnValue(q.reject('Honey, you got a big storm comin'));
            mongoUtils.findObject(mockColl, { foo: 'bar', status: 'active' }).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(mockColl.find).toHaveBeenCalledWith({ foo: 'bar', status: 'active' }, { limit: 1 });
                expect(error).toBe('Honey, you got a big storm comin');
            }).done(done);
        });
    });

    describe('createObject', function() {
        var mockColl;
        beforeEach(function() {
            mockColl = {
                insertOne: jasmine.createSpy('coll.insert()').and.returnValue(q(true))
            };
            spyOn(mongoUtils, 'escapeKeys').and.returnValue({ escaped: 'yes' });
        });

        it('should insert an object into a collection with some opts', function(done) {
            mongoUtils.createObject(mockColl, { orig: 'yes' }).then(function(resp) {
                expect(resp).toEqual({ escaped: 'yes' });
                expect(mongoUtils.escapeKeys).toHaveBeenCalledWith({ orig: 'yes' });
                expect(mockColl.insertOne).toHaveBeenCalledWith({ escaped: 'yes' }, { w: 1, j: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should log an error and reject if inserting the object fails', function(done) {
            mockColl.insertOne.and.returnValue(q.reject('I GOT A PROBLEM'));

            mongoUtils.createObject(mockColl, { orig: 'yes' }).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(mockColl.insertOne).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should trim off the _id field, if it exists', function(done) {
            mongoUtils.createObject(mockColl, { orig: 'yes', _id: 'asdf' }).then(function(resp) {
                expect(resp).toEqual({ escaped: 'yes' });
                expect(mongoUtils.escapeKeys).toHaveBeenCalledWith({ orig: 'yes' });
                expect(mockColl.insertOne).toHaveBeenCalledWith({ escaped: 'yes' }, { w: 1, j: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });

    describe('editObject', function() {
        var mockColl;
        beforeEach(function() {
            mockColl = {
                findOneAndUpdate: jasmine.createSpy('coll.findOneAndUpdate()').and.returnValue(q({ ok: 'yes', value: { updated: 'yes' } }))
            };
            spyOn(mongoUtils, 'escapeKeys').and.returnValue({ escaped: 'yes' });
        });

        it('should edit an object in a collection', function(done) {
            mongoUtils.editObject(mockColl, { foo: 'bar', lastUpdated: 'bloop' }, 'e-1').then(function(resp) {
                expect(resp).toEqual({ updated: 'yes' });
                expect(mongoUtils.escapeKeys).toHaveBeenCalledWith({ foo: 'bar', lastUpdated: jasmine.any(Date) });
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith({ id: 'e-1' },
                    { $set: { escaped: 'yes' } }, { w: 1, j: true, returnOriginal: false, sort: { id: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should log an error and reject if inserting the object fails', function(done) {
            mockColl.findOneAndUpdate.and.returnValue(q.reject('I GOT A PROBLEM'));

            mongoUtils.editObject(mockColl, { orig: 'yes' }, 'e-1').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should trim off the _id field, if it exists', function(done) {
            mongoUtils.editObject(mockColl, { foo: 'bar', _id: 'asdf' }, 'e-1').then(function(resp) {
                expect(resp).toEqual({ updated: 'yes' });
                expect(mongoUtils.escapeKeys).toHaveBeenCalledWith({ foo: 'bar', lastUpdated: jasmine.any(Date) });
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith({ id: 'e-1' },
                    { $set: { escaped: 'yes' } }, { w: 1, j: true, returnOriginal: false, sort: { id: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
});
