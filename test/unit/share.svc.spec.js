var path        = require('path'),
    fs          = require('fs-extra'),
    q           = require('q'),
    request     = require('request'),
    querystring = require('querystring'),
    cwrxConfig  = require('../../lib/config'),
    uuid        = require('../../lib/uuid'),
    sanitize    = require('../sanitize');

describe('share (UT)', function() {
    var share, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger,
        mockAws, putObjSpy;

    beforeEach(function() {
        traceSpy    = jasmine.createSpy('log_trace');
        errorSpy    = jasmine.createSpy('log_error');
        warnSpy     = jasmine.createSpy('log_warn');
        infoSpy     = jasmine.createSpy('log_info');
        fatalSpy    = jasmine.createSpy('log_fatal');
        logSpy      = jasmine.createSpy('log_log');
        putObjSpy   = jasmine.createSpy('s3_putObj');
        
        var mockLog = {
            trace : traceSpy,
            error : errorSpy,
            warn  : warnSpy,
            info  : infoSpy,
            fatal : fatalSpy,
            log   : logSpy        
        };

        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };
        mockAws = {
            config: {
                loadFromPath: jasmine.createSpy('aws_config_loadFromPath')
            },
            S3: function() {
                return {
                    putObject: putObjSpy
                };
            }
        };

        share = sanitize(['../bin/share'])
                .andConfigure([['../lib/logger', mockLogger], ['aws-sdk', mockAws]])
                .andRequire();
    });

    describe('getVersion', function() {
        var existsSpy, readFileSpy;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            readFileSpy = spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(share.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(share.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/share.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/share.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/share.version'));
        });
    });

    describe('createConfiguration', function() {
        var existsSpy, mkdirSpy, createConfig, mockConfig;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            mkdirSpy = spyOn(fs, 'mkdirsSync');
            mockConfig = {
                caches: {
                    run: 'ut/run/'
                },
                log: {
                    logLevel: 'trace'
                },
                s3: {
                    auth: 'fakeAuth.json'
                }
            };
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
        });
    
        it('should exist', function() {
            expect(share.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = share.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', share.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.run).toBe('ut/run/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            mockAws.config.loadFromPath.andThrow('Exception!');
            expect(function() {share.createConfiguration({config: 'utConfig'});}).toThrow();

            mockAws.config.loadFromPath.andReturn();
            delete mockConfig.s3;
            expect(function() {share.createConfiguration({config: 'utConfig'});}).toThrow();
        });
        
        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = share.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(false);
                cfgObject.ensurePaths();
                expect(existsSpy).toHaveBeenCalledWith('ut/run/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/run/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = share.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(true);
                cfgObject.ensurePaths();
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = share.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.pid', 'run')).toBe('ut/run/test.pid');
        });
    });
    
    describe('shortenUrl', function() {
        var config, url;
        
        beforeEach(function() {
            url = 'http://cinema6.com';
            config = {
                awesm: {
                    key: 'awesmKey',
                    releaseTool: 'relTool',
                    stagingTool: 'stagTool'
                }
            };
            spyOn(request, 'post');
        });
        
        it('should exist', function() {
            expect(share.shortenUrl).toBeDefined();
        });
        
        it('should properly send a request to awesm', function(done) {
            request.post.andCallFake(function(opts, cb) {
                cb(null, null, '{"awesm_url": "http://cinema6.com/short"}');
            });
            
            share.shortenUrl(url, config, null).then(function(shortUrl) {
                expect(shortUrl).toBe('http://cinema6.com/short');
                expect(request.post).toHaveBeenCalled();
                var opts = request.post.calls[0].args[0];
                expect(opts.url.match(/^http:\/\/api.awe.sm\/url\.json\?v=3/)).toBeTruthy();
                
                var query = querystring.parse(opts.url.split('?')[1]);
                expect(query.key).toBe('awesmKey');
                expect(query.tag).toBe('staging');
                expect(query.tool).toBe('stagTool');
                expect(query.url).toBe('http://cinema6.com');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should handle errors properly', function(done) {
            request.post.andCallFake(function(opts, cb) {
                cb('Error!', null, null);
            });
            share.shortenUrl(url, config, null).catch(function(error) {
                expect(error).toBe('Error!');
            });
            
            request.post.andCallFake(function(opts, cb) {
                cb(null, null, '{"error": "error in body"}');
            });
            share.shortenUrl(url, config, null).catch(function(error) {
                expect(error).toBe('{"error": "error in body"}');
            });
            
            request.post.andCallFake(function(opts, cb) {
                cb(null, null, 'improper json');
            });
            share.shortenUrl(url, config, null).catch(function(error) {
                expect(error).toBe('error parsing response as json');
                done();
            });
        });
        
        it('should properly use awesm params passed to it', function(done) {
            var params = {
                tag: 'release',
                campaign: 'utCampaign',
                notes: 'utNotes'
            }
            request.post.andCallFake(function(opts, cb) {
                cb(null, null, '{"awesm_url": "http://cinema6.com/short"}');
            });
            
            share.shortenUrl(url, config, params).then(function(shortUrl) {
                expect(shortUrl).toBe('http://cinema6.com/short');
                expect(request.post).toHaveBeenCalled();
                
                var opts = request.post.calls[0].args[0];
                var query = querystring.parse(opts.url.split('?')[1]);
                expect(query.tool).toBe('relTool');
                expect(query.tag).toBe('release');
                expect(query.campaign).toBe('utCampaign');
                expect(query.notes).toBe('utNotes');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should use the static api endpoint if the staticLink param is passed to it', function(done) {
            request.post.andCallFake(function(opts, cb) {
                cb(null, null, '{"awesm_url": "http://cinema6.com/short"}');
            });
            share.shortenUrl(url, config, null, true).then(function(shortUrl) {
                expect(shortUrl).toBe('http://cinema6.com/short');
                expect(request.post).toHaveBeenCalled();
                var opts = request.post.calls[0].args[0];
                expect(opts.url.match(/^http:\/\/api.awe.sm\/url\/static\.json\?v=3/)).toBeTruthy();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('shareLink', function() {
        var config, req, uuidSpy;
                
        beforeEach(function() {
            spyOn(share, 'shortenUrl').andCallFake(function(orig) {
                return q(orig + '?short=true');
            });
            uuidSpy = spyOn(uuid, 'createUuid').andReturn('ut1');
            config = {
                s3: {
                    share: {
                        bucket: 'ut_bucket',
                        path: 'ut/'
                    }
                }
            };
            req = {
                uuid: 'abc123',
                body: {
                    origin: 'http://cinema6.com/#/experiences/utApp~oldId',
                }
            };
        });
    
        it('should exist', function() {
            expect(share.getVersion).toBeDefined();
        });
        
        it('should correctly return a link if not given an experience object', function(done) {
            share.shareLink(req, null, function (err, url, shortUrl) {
                expect(err).toBeNull();
                expect(url).toBe('http://cinema6.com/#/experiences/utApp~oldId');
                expect(shortUrl).toBe('http://cinema6.com/#/experiences/utApp~oldId?short=true');
                done();
            });
        });

        it('should fail if not given an origin url', function(done) {
            req = { uuid: 'abc123' };
            
            share.shareLink(req, null, function(err, url) {
                expect(err).toBeDefined('err');
                expect(url).not.toBeDefined();
            });
            
            req.body = {data: {id: 'e-1'}};
            share.shareLink(req, null, function(err, url) {
                expect(err).toBeDefined('err');
                expect(url).not.toBeDefined();
                expect(errorSpy.calls.length).toBe(2);
                expect(share.shortenUrl).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle failures to shorten the url', function(done) {
            share.shortenUrl.andCallFake(function() {
                return q.reject('Error!');
            });
            
            share.shareLink(req, null, function(err, url, shortUrl) {
                expect(err).toBeNull();
                expect(url).toBe('http://cinema6.com/#/experiences/utApp~oldId');
                expect(shortUrl).toBeNull();
                expect(errorSpy).toHaveBeenCalled();
                done();
            });
        });
                    
        it('should correctly upload an experience and return a link for it', function(done) {
            req.body.data = {
                id: 'oldId',
                uri: 'utApp~oldId',
                title: 'Test Experience'
            };
            putObjSpy.andCallFake(function(params, cb) {
                cb(null, 'Success!');
            });
            share.shareLink(req, config, function(err, url, shortUrl) {
                expect(err).toBeNull();
                expect(url).toBe('http://cinema6.com/#/experiences/shared~utApp~e-ut1');
                expect(shortUrl).toBe('http://cinema6.com/#/experiences/shared~utApp~e-ut1?short=true');
                
                expect(putObjSpy).toHaveBeenCalled();
                var putParams = putObjSpy.calls[0].args[0];
                expect(putParams.Bucket).toBe('ut_bucket');
                expect(putParams.Key).toBe('ut/e-ut1.json');
                expect(putParams.ACL).toBe('public-read');
                expect(putParams.ContentType).toBe('application/JSON');
                
                var modExp = JSON.parse(putParams.Body);
                expect(modExp).toBeDefined();
                expect(modExp.id).toBe('e-ut1');
                expect(modExp.uri).toBe('shared~utApp~e-ut1');
                expect(modExp.title).toBe('Test Experience');
                done();
            });
        });
        
        it('should handle S3 failures', function(done) {
            req.body.data = {
                id: 'oldId',
                uri: 'utApp~oldId',
                title: 'Test Experience'
            };
            putObjSpy.andCallFake(function(params, cb) {
                cb('Oh noes S3 broke', null);
            });
            
            share.shareLink(req, config, function(err, url, shortUrl) {
                expect(putObjSpy).toHaveBeenCalled();
                expect(err).toBe('Oh noes S3 broke');
                expect(url).not.toBeDefined();
                expect(shortUrl).not.toBeDefined();
                expect(share.shortenUrl).not.toHaveBeenCalled();
                done();
            });
        });
    }); // end -- describe shareLink
}); // end -- describe share

