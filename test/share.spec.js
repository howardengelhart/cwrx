var path        = require('path'),
    fs          = require('fs-extra'),
    share       = require('../bin/share');
    

describe('share', function() {

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
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
        });
    });

    describe('createConfiguration', function() { // TODO
        var existsSpy, mkdirSpy,
            cwrxConfig = require('../lib/config');
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            mkdirSpy = spyOn(fs, 'mkdirsSync');
        });
    
        it('should exist', function() {
            expect(share.getVersion).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            
        });
    });

    describe('shareLink', function() {
        var req;
        
        it('should exist', function() {
            expect(share.getVersion).toBeDefined();
        });
        
        it('should correctly return a link if not given an experience object', function() {
            req = {
                uuid: 'abc123',
                body: {
                    origin: 'http://cinema6.com/#/experiences/ut'
                }
            };
            
            share.shareLink(req, null, function (err, url) {
                expect(err).toBeNull();
                expect(url).toBe('http://cinema6.com/#/experiences/ut');
            });
        });
    });
});

