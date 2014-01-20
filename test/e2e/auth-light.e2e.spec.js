var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    config      = {
        authUrl   : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/auth',
        maintUrl : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint'
    };

jasmine.getEnv().defaultTimeoutInterval = 10000;

describe('auth-light (E2E)', function() {
    var testNum = 0;
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'auth.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing auth log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('auth.log', config.maintUrl, jasmine.getEnv().currentSpec, 'auth-light', ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
    xdescribe('/auth/login', function() {
        it('should succeed given valid credentials', function(done) {
        
        });
    });
    
    // TODO: test signup???

    describe('/auth/meta', function() {
        it('should print out appropriate metadata about the auth service', function(done) {
            var options = {
                url: config.authUrl + '/meta'
            };
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(resp.body.config).toBeDefined();
                
                expect(resp.body.config.session).toBeDefined();
                expect(resp.body.config.session.key).toBeDefined();
                expect(resp.body.config.session.maxAge).toBeDefined();
                expect(resp.body.config.session.db).toBeDefined();
                
                expect(resp.body.config.mongo).toBeDefined();
                expect(resp.body.config.mongo.host).toBeDefined();
                expect(resp.body.config.mongo.port).toBeDefined();
                expect(resp.body.config.mongo.db).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe /auth/meta
});  // end -- describe auth (E2E)
