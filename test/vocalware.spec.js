var path      = require('path'),
    fs        = require('fs');
    mux       = require('../../mux'),
    vocalWare = mux.vocalWare;

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
        var init = {
                        apiId       : '2312497',
                        accountId   : '3692723',
                        secret      : 'a5fee309e61db9ff9a5d75dd04c0b759'
                    },
            token = vocalWare.createAuthToken(init);

        expect(token.getApiId()).toEqual(init.apiId);
        expect(token.getAccountId()).toEqual(init.accountId);
        expect(token.getSecret()).toEqual(init.secret);
    });

    it('should except if missing data from the init object',function(){
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
            init = {
                        apiId       : '2312497',
                        accountId   : '3692723',
                        secret      : 'a5fee309e61db9ff9a5d75dd04c0b759'
                    },
            token;
        files.push(dummy);
        fs.writeFileSync(dummy,JSON.stringify(init));
        token = vocalWare.createAuthToken(dummy);

        expect(token.getApiId()).toEqual(init.apiId);
        expect(token.getAccountId()).toEqual(init.accountId);
        expect(token.getSecret()).toEqual(init.secret);
    });
    
    it('should except if the token file is bad',function(){
        expect(function(){
            vocalWare.createAuthToken(__filename);
        }).toThrow('unable to parse json from token file: Unexpected token v');
    });
});

describe('vocalware request',function(){
    var authToken = vocalWare.createAuthToken({
                        apiId       : '2312497',
                        accountId   : '3692723',
                        secret      : 'a5fee309e61db9ff9a5d75dd04c0b759'
                    });

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

        expect(cksum).toEqual('2c0ef3a9575c00635d3e00ed88a53b16');
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
        console.log(opts,null,3);
        expect(opts).not.toBeNull();
    });
});

/*
describe('vocalware textToSpeech',function(){
    var files = [],
        token = vocalWare.createAuthToken({
                        apiId       : '2312497',
                        accountId   : '3692723',
                        secret      : 'a5fee309e61db9ff9a5d75dd04c0b759'
                    });

    afterEach(function(){
        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });

    it('should convert text to speech with say',function(done){
        expect(token).toBeDefined();
        var rqs = vocalWare.createRequest({ authToken   : token }),
            outputFile = path.join(__dirname,'speech.mp3');
        rqs.say('This is a test.');
       
        vocalWare.textToSpeech(rqs,outputFile,function(err,r,o){
            expect(err).toBeNull();
            expect(r).toBe(rqs);
            expect(o).toEqual(outputFile);
            expect(fs.existsSync(o)).toEqual(true);
            done();
        });
        files.push(outputFile);
    });

});
*/
