var path        = require('path'),
    sanitize    = require('../sanitize'),
    vocalWare   = require('../../lib/vocalware'),
    fsMock = {};

describe('vocalWare', function() {
    
    beforeEach(function(){
        var fs      = require('fs');
        fsMock.readFileSync      = spyOn(fs, 'readFileSync');
        fsMock.existsSync        = spyOn(fs, 'existsSync');
        fsMock.createWriteStream = spyOn(fs, 'createWriteStream');
    });


    describe('voices', function(){

        afterEach(function(){
            vocalWare.voices.defaultVoice(vocalWare.voices.Susan);
        });
       
        describe('isValid',function(){
            it('should exist',function(){
                expect(vocalWare.voices.isValid).toBeDefined();
            });

            it('should return true if given a valid voice definition',function(){
                expect(vocalWare.voices.isValid({
                    EngineId: function() { return 7; }, 
                    LangId:   function() { return 8; }, 
                    VoiceId:  function() { return 9; }
                })).toEqual(true);
            });

            it('should except if voice definition is missing EngineId',function(){
                expect(function() {
                    vocalWare.voices.isValid({
                        LangId:   function() { return 8; }, 
                        VoiceId:  function() { return 9; }
                    });
                }).toThrow('voice is not valid, missing method "EngineId"');
            });
            
            it('should except if voice definition is missing LangId',function(){
                expect(function() {
                    vocalWare.voices.isValid({
                        EngineId: function() { return 7; }, 
                        VoiceId:  function() { return 9; }
                    });
                }).toThrow('voice is not valid, missing method "LangId"');
            });
            
            it('should except if voice definition is missing VoiceId',function(){
                expect(function() {
                    vocalWare.voices.isValid({
                        EngineId: function() { return 7; }, 
                        LangId:   function() { return 8; }
                    });
                }).toThrow('voice is not valid, missing method "VoiceId"');
            });
        });

        describe('defaultVoice',function(){
            it('should exist',function(){
                expect(vocalWare.voices.defaultVoice).toBeDefined();
            });

            it('works as a getter',function(){
                var defaultVoice = vocalWare.voices.defaultVoice();
                expect(defaultVoice.EngineId).toBeDefined();
                expect(defaultVoice.LangId).toBeDefined();
                expect(defaultVoice.VoiceId).toBeDefined();
            });

            it('works as a setter',function(){
                var oldVoice = vocalWare.voices.defaultVoice(), newVoice;
                    vocalWare.voices.defaultVoice({
                        EngineId: function() { return oldVoice.EngineId() + 100; }, 
                        LangId:   function() { return oldVoice.LangId()   + 100; }, 
                        VoiceId:  function() { return oldVoice.VoiceId()  + 100; }
                    });
                    newVoice = vocalWare.voices.defaultVoice();

                expect(newVoice.EngineId()).toEqual(oldVoice.EngineId() + 100);
                expect(newVoice.LangId()).toEqual(oldVoice.LangId() + 100);
                expect(newVoice.VoiceId()).toEqual(oldVoice.VoiceId() + 100);
            });

            it('excepts if set with an invalid voice',function(){
                expect(function() {
                    vocalWare.voices.defaultVoice({
                        EngineId: function() { return 7; }, 
                        LangId:   function() { return 8; }
                    });
                }).toThrow('voice is not valid, missing method "VoiceId"');
            });
        });
    });

    describe('authentication',function(){

        it('should create authToken from init object with an apiId',function(){
            var tokenData = {
                            apiId       : '9999999',
                            accountId   : '9999999',
                            secret      : '99999999999999999999999999999999',
                            service     : 'vocalware'
                },
                token = vocalWare.createAuthToken(tokenData);

            expect(token.getApiId()).toEqual(tokenData.apiId);
            expect(token.getAccountId()).toEqual(tokenData.accountId);
            expect(token.getSecret()).toEqual(tokenData.secret);
            expect(token.getService()).toEqual(tokenData.service);
        });

        it('should create authToken from init object without an apiId',function(){
            var tokenData = {
                            accountId   : '9999999',
                            secret      : '99999999999999999999999999999999',
                            service     : 'vocalware'
                },
                token = vocalWare.createAuthToken(tokenData);

            expect(token.getApiId()).not.toBeDefined();
            expect(token.getAccountId()).toEqual(tokenData.accountId);
            expect(token.getSecret()).toEqual(tokenData.secret);
            expect(token.getService()).toEqual(tokenData.service);
        });
        
        it('should except if accountId or secret are missing',function(){
            expect(function(){
                vocalWare.createAuthToken({ apiId : 'xxx', accountId : 'yyyy', service: 'vw'});
            }).toThrow('token is missing secret');
            expect(function(){
                vocalWare.createAuthToken({ apiId : 'xxx', secret : 'yyyy', service: 'vw'});
            }).toThrow('token is missing accountId');
        });
        
        it('should create authToken from file with apiId',function(){
            var tokenData = {
                apiId : 'abc',
                accountId: 'def',
                secret: 'ghi',
                service: 'vocalware'
            }, token;

            fsMock.readFileSync.andReturn(JSON.stringify(tokenData));
            token = vocalWare.createAuthToken('somefile.json');
            expect(fsMock.readFileSync).toHaveBeenCalledWith('somefile.json');
            expect(token.getApiId()).toEqual(tokenData.apiId);
            expect(token.getAccountId()).toEqual(tokenData.accountId);
            expect(token.getSecret()).toEqual(tokenData.secret);
            expect(token.getService()).toEqual(tokenData.service);
        });

        it('should create authToken from file without apiId',function(){
            var tokenData = {
                accountId: 'def',
                secret: 'ghi',
                service: 'vocalware'
            }, token;

            fsMock.readFileSync.andReturn(JSON.stringify(tokenData));
            token = vocalWare.createAuthToken('somefile.json');
            expect(fsMock.readFileSync).toHaveBeenCalledWith('somefile.json');
            expect(token.getAccountId()).toEqual(tokenData.accountId);
            expect(token.getSecret()).toEqual(tokenData.secret);
            expect(token.getService()).toEqual(tokenData.service);
        });
        
        it('should except if the token file read fails',function(){
            fsMock.readFileSync.andCallFake(function(){
                throw new Error('failed!');    
            });
            expect(function(){
                vocalWare.createAuthToken(__filename);
            }).toThrow('read token file failed: failed!');
        });
    });

    describe('createRequest',function(){

        it('should return a default request object when no arguments are passed',function(){
            var rqs = vocalWare.createRequest();
            expect(rqs).toBeDefined();
            expect(rqs).not.toBeNull();
            expect(rqs.authToken).toBeNull();
            expect(rqs.engineId).toEqual(vocalWare.voices.defaultVoice().EngineId());
            expect(rqs.langId).toEqual(vocalWare.voices.defaultVoice().LangId());
            expect(rqs.voiceId).toEqual(vocalWare.voices.defaultVoice().VoiceId());
            expect(rqs.text).toBeNull();
            expect(rqs.ext).toEqual('mp3');
            expect(rqs.fxType).toBeNull();
            expect(rqs.fxLevel).toBeNull();
            expect(rqs.session).toBeNull();
            expect(rqs.service).toEqual('vocalware');
            expect(rqs.serviceHostName).toEqual('www.vocalware.com');

            expect(rqs.say).toBeDefined();
            expect(rqs.checksum).toBeDefined();
            expect(rqs.toHttpOpts).toBeDefined();
        });

        it('should override request properites if passed in parameter',function(){
            var rqs = vocalWare.createRequest({
                fxType : 'D',
                fxLevel : 2,
                text    : 'this is a test'
            });
            
            expect(rqs).toBeDefined();
            expect(rqs).not.toBeNull();
            expect(rqs.authToken).toBeNull();
            expect(rqs.engineId).toEqual(vocalWare.voices.defaultVoice().EngineId());
            expect(rqs.langId).toEqual(vocalWare.voices.defaultVoice().LangId());
            expect(rqs.voiceId).toEqual(vocalWare.voices.defaultVoice().VoiceId());
            expect(rqs.text).toEqual('this is a test');
            expect(rqs.ext).toEqual('mp3');
            expect(rqs.fxType).toEqual('D');
            expect(rqs.fxLevel).toEqual(2);
            expect(rqs.session).toBeNull();
            expect(rqs.service).toEqual('vocalware');
            expect(rqs.serviceHostName).toEqual('www.vocalware.com');

            expect(rqs.say).toBeDefined();
            expect(rqs.checksum).toBeDefined();
            expect(rqs.toHttpOpts).toBeDefined();

        });

        it('should set request to authToken service if set',function(){
            var token = vocalWare.createAuthToken({
                    apiId       : 'abc',
                    accountId   : 'def',
                    secret      : 'ghi',
                    service     : 'oddcast'
                });
            rqs = vocalWare.createRequest({ authToken : token, text : 'hello' });
            expect(rqs.service).toEqual('oddcast');
        });

        it('should apply the correct hostName if service is "vocalware"',function(){
            var rqs = vocalWare.createRequest({
                service    : 'vocalware'
            });
            
            expect(rqs.service).toEqual('vocalware');
            expect(rqs.serviceHostName).toEqual('www.vocalware.com');
        });
        
        it('should apply the correct hostName if service is "oddcast"',function(){
            var rqs = vocalWare.createRequest({
                service    : 'oddcast'
            });
            
            expect(rqs.service).toEqual('oddcast');
            expect(rqs.serviceHostName).toEqual('cache.oddcast.com');

        });
        
        it('should not override serviceHostName if specified',function(){
            var rqs = vocalWare.createRequest({
                service         : 'oddcast',
                serviceHostName : 'cache.oddcast.net'
            });
            
            expect(rqs.service).toEqual('oddcast');
            expect(rqs.serviceHostName).toEqual('cache.oddcast.net');
        });
        
        it('should except if an unrecognized service is specified',function(){
            expect(function(){
                vocalWare.createRequest({ service : 'foo' });
            }).toThrow('invalid service: "foo"');

        });

    });
    
    describe('request::say',function(){
        var rqs;

        beforeEach(function(){
            rqs = vocalWare.createRequest();
        });

        it('should except if no text is passed',function(){
            expect(function() {
                rqs.say();
            }).toThrow('text parameter required');
        });

        it('should set rqs with text passed',function(){
            expect(rqs.text).toBeNull();
            expect(rqs.engineId).toEqual(2);
            expect(rqs.langId).toEqual(1);
            expect(rqs.voiceId).toEqual(1);
            rqs.say('hello'); 
            expect(rqs.text).toEqual('hello');
            expect(rqs.engineId).toEqual(2);
            expect(rqs.langId).toEqual(1);
            expect(rqs.voiceId).toEqual(1);
        });

        it('should use voice if passed by name',function(){
            expect(rqs.text).toBeNull();
            rqs.say('hello, this is dave','Dave'); 
            expect(rqs.text).toEqual('hello, this is dave');
            expect(rqs.engineId).toEqual(2);
            expect(rqs.langId).toEqual(1);
            expect(rqs.voiceId).toEqual(2);
        });

        it('should except if passed a bad voice name',function(){
            expect(function() {
                rqs.say('hello, this is xyy','xyy');
            }).toThrow('invalid voice: "xyy"');
        });
        
        it('should use voice data if passed',function(){
            expect(rqs.text).toBeNull();
            rqs.say('hello, this is dave', { 
                EngineId: function() { return 7; }, 
                LangId:   function() { return 8; }, 
                VoiceId:  function() { return 9; }
            }); 
            expect(rqs.text).toEqual('hello, this is dave');
            expect(rqs.engineId).toEqual(7);
            expect(rqs.langId).toEqual(8);
            expect(rqs.voiceId).toEqual(9);
        });
        
        it('should except if passed a bad voice object',function(){
            expect(function() {
                rqs.say('hello, this is xyy', {});
            }).toThrow('voice is not valid, missing method "EngineId"');
        });
    });

    describe('request::checksum',function(){
        var rqs;
        beforeEach(function(){
            var token = vocalWare.createAuthToken({
                    apiId       : 'abc',
                    accountId   : 'def',
                    secret      : 'ghi'
                });
            rqs = vocalWare.createRequest({ authToken : token, text : 'hello' });
        });

        it('excepts if missing an authToken',function(){
            rqs.authToken = null;
            expect(function() {
                rqs.checksum();
            }).toThrow('authToken is required');
        });
        
        it('excepts if missing engineId',function(){
            rqs.engineId = null;
            expect(function() {
                rqs.checksum();
            }).toThrow('engineId is required');
        });

        it('excepts if missing langId',function(){
            rqs.langId = null;
            expect(function() {
                rqs.checksum();
            }).toThrow('langId is required');
        });

        it('excepts if missing voiceId',function(){
            rqs.voiceId = null;
            expect(function() {
                rqs.checksum();
            }).toThrow('voiceId is required');
        });

        it('excepts if missing text',function(){
            rqs.text = null;
            expect(function() {
                rqs.checksum();
            }).toThrow('text is required');
        });

        it('returns a valid result with a valid request with an ApiId',function(){
            var result = rqs.checksum();
            expect(result).toEqual('9223dae9729bd0c3251e04194ab7deb0');
        });
        
        it('returns a valid result with a valid request without an ApiId',function(){
            var token = vocalWare.createAuthToken({
                    accountId   : 'def',
                    secret      : 'ghi'
                }), rqs, result;

            rqs = vocalWare.createRequest({ authToken : token, text : 'hello' });
            result = rqs.checksum();
            expect(result).toEqual('b86068911b89d2e062166e8e1353cfa4');
        });
    });
    
    describe('request::toHttpOpts',function(){
        it('generates a valid opts for a vocalWare request',function(){
            var token = vocalWare.createAuthToken({
                    apiId       : 'abc',
                    accountId   : 'def',
                    secret      : 'ghi'
                }), rqs, opts;
            rqs = vocalWare.createRequest({ authToken : token, text : 'hello' });
            opts = rqs.toHttpOpts();
            expect(rqs.toHttpOpts()).toEqual({ 
                hostname: 'www.vocalware.com',
                port: 80,
                path: '/tts/gen.php?EID=2&LID=1&VID=1&TXT=hello&EXT=mp3&FX_TYPE=&FX_LEVEL=&ACC=def&API=abc&SESSION=&CS=9223dae9729bd0c3251e04194ab7deb0',
                method: 'GET'
            });
        });

        it('generates a valid opts for a oddcast request',function(){
            var token = vocalWare.createAuthToken({
                    accountId   : 'def',
                    secret      : 'ghi'
                }), rqs, opts;

            rqs = vocalWare.createRequest({ 
                authToken : token, 
                text : 'hello',
                service : 'oddcast' 
            });
            opts = rqs.toHttpOpts();
            expect(rqs.toHttpOpts()).toEqual({ 
                hostname: 'cache.oddcast.com',
                port: 80,
                path: '/tts/gen.php?EID=2&LID=1&VID=1&TXT=hello&EXT=mp3&FX_TYPE=&FX_LEVEL=&ACC=def&SESSION=&CS=b86068911b89d2e062166e8e1353cfa4',
                method: 'GET'
            });
        });

    });

    describe('textToSpeech',function(){
        var rqs, cbSpy, httpMock, httpResponseMock, httpRequestMock, nextTickSpy,
            ttsHttpCallback, writeStreamMock;
        beforeEach(function(){
            var token = vocalWare.createAuthToken({
                    apiId       : 'abc',
                    accountId   : 'def',
                    secret      : 'ghi'
                });
            rqs = vocalWare.createRequest({ authToken : token, text : 'hello' });
            cbSpy = jasmine.createSpy('textToSpeechCallback');

            // The _events object on these mocks are used to capture the
            // callback functions vocalWare.textToSpeech will set vian "on" method calls.
            // They are initialized with no-ops
            writeStreamMock = {
                write   : jasmine.createSpy('ws::write'),
                on      : jasmine.createSpy('ws::on'),
                end     : jasmine.createSpy('ws::end'),
                _events : {
                    'close' : function(){}
                }
            };

            httpResponseMock = {
                statusCode : 0,
                headers : { 'content-type' : 'text/plain' },
                on      : jasmine.createSpy('httpResponseMock::on'),
                _events :  {
                    'data' : function(){},
                    'end'  : function(){}
                }
            };
            
            httpRequestMock = {
                on  : jasmine.createSpy('httpRequestMock::on'),
                end : jasmine.createSpy('httpRequestMock::end'),
                _events : {
                    'error' : function(){}
                }
            };
       
            httpMock = {};
            httpMock.request = spyOn(require('http'), 'request');
           
            // ttsHttpCallback is the function that vocalWare.textToSpeech
            // will pass to http.request.  We need to capture that so the
            // unit tests can use it to pass back the httpResponseMock
            // with the correct statusCode / headers for the given test.
            httpMock.request.andCallFake(function(opts,callback){
                ttsHttpCallback = callback;
                return httpRequestMock;
            });

            httpRequestMock.on.andCallFake(function(eventName,callback){
                httpRequestMock._events[eventName] = callback;
            });

            httpResponseMock.on.andCallFake(function(eventName,callback){
                httpResponseMock._events[eventName] = callback;
            });

            writeStreamMock.on.andCallFake(function(eventName,callback){
                writeStreamMock._events[eventName] = callback;
            });
            
            fsMock.createWriteStream.andReturn(writeStreamMock);
            fsMock.existsSync.andReturn(false);

            nextTickSpy      = spyOn(process, 'nextTick');
            nextTickSpy.andCallFake(function(cb){
                cb();
            });
        });

        it('will callback with an error if the output exists',function(){
            fsMock.existsSync.andReturn(true);
            vocalWare.textToSpeech(rqs,'somefile.mp3',cbSpy);
            expect(cbSpy.mostRecentCall.args[0].message)
                .toEqual('File already exists: somefile.mp3');
        });

        it('will callback with an error if the request is invalid',function(){
            vocalWare.textToSpeech(vocalWare.createRequest(),'somefile.mp3',cbSpy);
            expect(cbSpy.mostRecentCall.args[0].message)
                .toEqual('Cannot call method \'getAccountId\' of null');
        });

        it('will callback with an error if the request does not succeed',function(){
            
            httpResponseMock.on.andCallFake(function(eventName,cb){
                if (eventName === 'data'){
                    return cb( 'Too many TTS Requests' );
                }

                if (eventName === 'end'){
                    return cb();
                }
            });

            vocalWare.textToSpeech(rqs,'somefile.mp3',cbSpy);

            httpResponseMock.statusCode = 301;
            
            ttsHttpCallback(httpResponseMock);

            httpResponseMock._events.data('Too many TTS Requests');
            httpResponseMock._events.end();
            
            expect(cbSpy.mostRecentCall.args[0].message)
                .toEqual('request error: Too many TTS Requests');
        });

        it('will handle a successful request',function(){
            vocalWare.textToSpeech(rqs,'somefile.mp3',cbSpy);

            httpResponseMock.statusCode = 200;
            httpResponseMock.headers['content-type'] = 'audio/mpeg';
            
            ttsHttpCallback(httpResponseMock);
            
            httpResponseMock._events.data('chunk1');
            httpResponseMock._events.data('chunk2');
            httpResponseMock._events.data('chunk3');
            httpResponseMock._events.end();
            writeStreamMock._events.close();

            expect(writeStreamMock.write.calls[0].args[0]).toEqual('chunk1');
            expect(writeStreamMock.write.calls[1].args[0]).toEqual('chunk2');
            expect(writeStreamMock.write.calls[2].args[0]).toEqual('chunk3');
            expect(writeStreamMock.end).toHaveBeenCalled();

            expect(cbSpy.mostRecentCall.args[0]).toBeNull();
            expect(cbSpy.mostRecentCall.args[1]).toBe(rqs);
            expect(cbSpy.mostRecentCall.args[2]).toEqual('somefile.mp3');
        });
    });
});
