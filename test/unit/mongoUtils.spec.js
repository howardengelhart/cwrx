var mongodb     = require('mongodb'),
    mongoUtils  = require('../../lib/mongoUtils');
    
describe('mongoUtils', function() {
    describe('connect', function() {
        var openSpy = jasmine.createSpy('client_open'),
            fakeClient;
            
        beforeEach(function() {
            fakeClient = {
                name: 'fakeClient',
                open: openSpy
            };
            spyOn(mongodb, 'MongoClient').andReturn(fakeClient);
            spyOn(mongodb, 'Server').andReturn({ name: 'fakeServer'});
        });
        
        it('should correctly setup the client and connect', function(done) {
            openSpy.andCallFake(function(cb) {
                cb(null, fakeClient);
            });
            mongoUtils.connect('10.0.0.1.', '666').then(function(client) {
                expect(client).toBeDefined();
                expect(client.name).toBe('fakeClient');
                expect(mongodb.Server).toHaveBeenCalledWith('10.0.0.1.', '666');
                expect(mongodb.MongoClient).toHaveBeenCalledWith({name: 'fakeServer'}, {native_parser:true});
                expect(openSpy).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should pass along errors from connecting', function(done) {
            openSpy.andCallFake(function(cb) {
                cb('Error!');
            });
            mongoUtils.connect('10.0.0.1.', '666').catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongodb.Server).toHaveBeenCalledWith('10.0.0.1.', '666');
                expect(mongodb.MongoClient).toHaveBeenCalledWith({name: 'fakeServer'}, {native_parser:true});
                expect(openSpy).toHaveBeenCalled();
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
