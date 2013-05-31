var path      = require('path'),
    fs        = require('fs'),
    crypto    = require('crypto'),
    cwrx      = require('../../cwrx'),
    vocalWare = cwrx.vocalWare,
    tokenData = {
                    apiId       : '9999999',
                    accountId   : '9999999',
                    secret      : '99999999999999999999999999999999'
    };

describe('vocalware authToken',function(){
    var files = [];
    afterEach(function(){
        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });
    it('should create authToken from init object',function(){
        var token = vocalWare.createAuthToken(tokenData);

        expect(token.getApiId()).toEqual(tokenData.apiId);
        expect(token.getAccountId()).toEqual(tokenData.accountId);
        expect(token.getSecret()).toEqual(tokenData.secret);
    });

    it('should except if missing data from the tokenData object',function(){
        expect(function(){
            vocalWare.createAuthToken({ apiId : 'xxx', accountId : 'yyyy'});
        }).toThrow('token is missing secret');
        expect(function(){
            vocalWare.createAuthToken({ apiId : 'xxx', secret : 'yyyy'});
        }).toThrow('token is missing accountId');
        expect(function(){
            vocalWare.createAuthToken({ secret : 'xxx', accountId : 'yyyy'});
        }).toThrow('token is missing apiId');
    });

    it('should create authToken from file',function(){
        var dummy = path.join(__dirname,'dummy'), 
            token;
        files.push(dummy);
        fs.writeFileSync(dummy,JSON.stringify(tokenData));
        token = vocalWare.createAuthToken(dummy);

        expect(token.getApiId()).toEqual(tokenData.apiId);
        expect(token.getAccountId()).toEqual(tokenData.accountId);
        expect(token.getSecret()).toEqual(tokenData.secret);
    });
    
    it('should except if the token file is bad',function(){
        expect(function(){
            vocalWare.createAuthToken(__filename);
        }).toThrow('unable to parse json from token file: Unexpected token v');
    });
});

describe('vocalware request',function(){
    var authToken = vocalWare.createAuthToken(tokenData);

    it('should create request without requiring params',function(){
        var req = vocalWare.createRequest();
        expect(req).toBeDefined();
        expect(req.engineId).toEqual(vocalWare.voices.defaultVoice().EngineId());
        expect(req.langId).toEqual(vocalWare.voices.defaultVoice().LangId());
        expect(req.voiceId).toEqual(vocalWare.voices.defaultVoice().VoiceId());
        expect(req.text).toBeNull();
        expect(req.ext).toEqual('mp3');
        expect(req.fxType).toBeNull();
        expect(req.fxLevel).toBeNull();
        expect(req.authToken).toBeNull();
    });

    it('should pay attention to an init object',function(){
        var init = {
                engineId    : vocalWare.voices.Dave.EngineId(),
                langId      : vocalWare.voices.Dave.LangId(),
                voiceId     : vocalWare.voices.Dave.VoiceId(),
                text        : 'this is a test'
            },
            req = vocalWare.createRequest(init);

        expect(req).toBeDefined();
        expect(req.engineId).toEqual(init.engineId);
        expect(req.langId).toEqual(init.langId);
        expect(req.voiceId).toEqual(init.voiceId);
        expect(req.text).toEqual(init.text);
        expect(req.ext).toEqual('mp3');
        expect(req.fxType).toBeNull();
        expect(req.fxLevel).toBeNull();
        expect(req.authToken).toBeNull();
    });

    it('should have a say method',function(){
        var init = {
                engineId    : vocalWare.voices.Dave.EngineId(),
                langId      : vocalWare.voices.Dave.LangId(),
                voiceId     : vocalWare.voices.Dave.VoiceId(),
            },
            req = vocalWare.createRequest(init);

        expect(req).toBeDefined();
        expect(req.engineId).toEqual(init.engineId);
        expect(req.langId).toEqual(init.langId);
        expect(req.voiceId).toEqual(init.voiceId);
        expect(req.text).toBeNull();
        expect(req.ext).toEqual('mp3');
        expect(req.fxType).toBeNull();
        expect(req.fxLevel).toBeNull();
        expect(req.authToken).toBeNull();

        req.say('hello');

        expect(req.engineId).toEqual(init.engineId);
        expect(req.langId).toEqual(init.langId);
        expect(req.voiceId).toEqual(init.voiceId);
        expect(req.text).toEqual('hello');
        expect(req.ext).toEqual('mp3');
        expect(req.fxType).toBeNull();
        expect(req.fxLevel).toBeNull();
        expect(req.authToken).toBeNull();
        
        req.say('goodby', vocalWare.voices.Susan);
        
        expect(req.engineId).toEqual(vocalWare.voices.Susan.EngineId());
        expect(req.langId).toEqual(vocalWare.voices.Susan.LangId());
        expect(req.voiceId).toEqual(vocalWare.voices.Susan.VoiceId());
        expect(req.text).toEqual('goodby');
        expect(req.ext).toEqual('mp3');
        expect(req.fxType).toBeNull();
        expect(req.fxLevel).toBeNull();
        expect(req.authToken).toBeNull();

        expect(function(){
            req.say();
        }).toThrow('text parameter required');
        
        expect(function(){
            req.say('blah',{});
        }).toThrow('voice is not valid');
    });

    it('should generate a checksum when valid',function(){
        var req = vocalWare.createRequest({ 'authToken' : authToken, 
                                            'text' : 'This is a test'}),
            cksum = req.checksum();

        expect(cksum).toEqual('acd0d374188e4ff0f1dbfcf403ca465e');
    });

    it('should not generate a checksum when not valid',function(){
        var req = vocalWare.createRequest();

        expect(function(){
            req.checksum();
        }).toThrow('authToken is required');

    });

    it('should generate http opts when valid',function(){
        var req = vocalWare.createRequest({ 'authToken' : authToken, 
                                            'text' : 'This is a test'}),
        opts = req.toHttpOpts();
        expect(opts).toEqual(
            { 
              hostname: 'www.vocalware.com',
              port: 80,
              path: '/tts/gen.php?EID=2&LID=1&VID=1&TXT=This%20is%20a%20test&EXT=mp3&FX_TYPE=&FX_LEVEL=&ACC=9999999&API=9999999&SESSION=&CS=acd0d374188e4ff0f1dbfcf403ca465e',
              method: 'GET' 
            }
        );
    });
});


describe('vocalware textToSpeech',function(){
    var token = vocalWare.createAuthToken({
                        apiId       : '2312497',
                        accountId   : '3692723',
                        secret      : 'a5fee309e61db9ff9a5d75dd04c0b759'
                    }),
        files = [];

    afterEach(function(){
        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });

    it('should convert text to speech with say',function(done){
        var token = vocalWare.createAuthToken(process.env['vwauth']),
            rqs = vocalWare.createRequest({ authToken   : token }),
            outputFile = path.join(__dirname,'speech.mp3');
        
        rqs.say('This is a test.');
       
        vocalWare.textToSpeech(rqs,outputFile,function(err,r,o){
            setTimeout(function(){
                expect(err).toBeNull();
                expect(r).toBe(rqs);
                expect(o).toEqual(outputFile);
                if (err === null && o !== null) {
                    expect(fs.existsSync(o)).toEqual(true);

                    var cksum = crypto.createHash('sha1'),
                        buff = fs.readFileSync(o);
                    
                    cksum.update(buff);
                    expect(buff.length).toEqual(9754);
                    expect(cksum.digest('hex')).toEqual('80b3418b0b9cbfcec52327d5637c000cab044800');
                }
                done();
            },500);
        });
        files.push(outputFile);
    });
    
    it('should not convert with a bad account info',function(done){
        var token = vocalWare.createAuthToken({
                            apiId       : '9999999',
                            accountId   : '9999999',
                            secret      : '99999999999999999999999999999999'
                        }),
            rqs = vocalWare.createRequest({ authToken   : token }),
            outputFile = path.join(__dirname,'speech.mp3');
        
        rqs.say('This is a test.');
       
        vocalWare.textToSpeech(rqs,outputFile,function(err,r,o){
            expect(err).not.toBeNull();
            expect(err.message).toEqual('request error: Error: [205] In-active account: In-active account.');
            expect(r).toBe(rqs);
            expect(o).toBeNull();
            done();
        });
        files.push(outputFile);
    });
});
