var flush = true;    
describe('mongoUtils', function() {
    var mongodb, mongoUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        mongodb     = require('mongodb');
        mongoUtils  = require('../../lib/mongoUtils');
    });
    
    describe('connect', function() {
        beforeEach(function() {
            spyOn(mongodb.MongoClient, 'connect').andCallFake(function(url, opts, cb) {
                cb(null, 'fakeDb');
            });
        });
        
        it('should correctly setup the client and connect', function(done) {
            mongoUtils.connect('10.0.0.1.', '666', 'fakeDb').then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls[0].args[0]).toBe('mongodb://10.0.0.1.:666/fakeDb');
                expect(mongodb.MongoClient.connect.calls[0].args[1])
                    .toEqual({ db: { native_parser: true, bufferMaxEntries: 0 } });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should include auth params if passed to the function', function(done) {
            mongoUtils.connect('10.0.0.1.', '666', 'fakeDb', 'test', 'password')
            .then(function(db) {
                expect(db).toBe('fakeDb');
                expect(mongodb.MongoClient.connect).toHaveBeenCalled();
                expect(mongodb.MongoClient.connect.calls[0].args[0])
                    .toBe('mongodb://test:password@10.0.0.1.:666/fakeDb');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if the required params are not provided', function(done) {
            mongoUtils.connect('10.0.0.1.', '666', null).catch(function(error) {
                expect(error).toBe('Must pass host, port, and db as params to mongoUtils.connect');
                return mongoUtils.connect('10.0.0.1', null, 'fakeDb');
            }).catch(function(error) {
                expect(error).toBe('Must pass host, port, and db as params to mongoUtils.connect');
                return mongoUtils.connect(null, '666', 'fakeDb');
            }).catch(function(error) {
                expect(error).toBe('Must pass host, port, and db as params to mongoUtils.connect');
                done();
            }).then(function(db) {
                expect(db).not.toBeDefined();
                done();
            });
        });
        
        it('should pass along errors from connecting', function(done) {
            mongodb.MongoClient.connect.andCallFake(function(url, opts, cb) {
                cb('Error!');
            });
            mongoUtils.connect('10.0.0.1.', '666', 'fakeDb').catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongodb.MongoClient.connect.calls[0].args[0]).toBe('mongodb://10.0.0.1.:666/fakeDb');
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
