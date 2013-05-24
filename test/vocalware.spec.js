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

});

/*
describe('vocalware test suite',function(){
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

    it('should have a vocalware object defined',function(){
        expect(vocalWare).toBeDefined();
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

    it('should convert text to speech say with voice',function(done){
        expect(token).toBeDefined();
        var rqs = vocalWare.createRequest({ authToken   : token }),
            outputFile = path.join(__dirname,'speech.mp3');
        rqs.say('This is a test.',vocalWare.voices.Susan);
        
        vocalWare.textToSpeech(rqs,outputFile,function(err,r,o){
            expect(err).toBeNull();
            expect(r).toBe(rqs);
            expect(o).toEqual(outputFile);
            expect(fs.existsSync(o)).toEqual(true);
            done();
        });
        files.push(outputFile);
    });

    it('should convert text to speech using attributes',function(done){
        expect(token).toBeDefined();
        var rqs = vocalWare.createRequest({ authToken   : token }),
            outputFile = path.join(__dirname,'speech.mp3');
        rqs.txt('This is a test.');
        rqs.engineId(2);
        rqs.voiceId(1);
        rqs.langId(1);
        
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
