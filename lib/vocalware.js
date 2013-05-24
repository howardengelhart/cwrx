var fs      = require('fs'),
    qs      = require('querystring'),
    crypto  = require('crypto'),
    vwVoices,
    defaultVoice;


vwVoices = {
    Susan       : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 1; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'US'; }
                  },
    Dave        : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 2; },
                    Gender       : function() { return 'M'; },
                    Description  : function() { return 'US'; }
                  },
    Elizabeth   : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 4; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'UK'; }
                  },
    Simon       : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 5; },
                    Gender       : function() { return 'M'; },
                    Description  : function() { return 'UK'; }
                  },
    Catherine   : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 6; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'UK'; }
                  },
    Allison     : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 7; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'US'; }
                  },
    Steven      : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 8; },
                    Gender       : function() { return 'M'; },
                    Description  : function() { return 'US'; }
                  },
    Alan        : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 9; },
                    Gender       : function() { return 'M'; },
                    Description  : function() { return 'Australian'; }
                  },
    Grace       : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 10; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'Australian'; }
                  },
    Veena       : { 
                    EngineId     : function() { return 2; }, 
                    LangId       : function() { return 1; }, 
                    VoiceId      : function() { return 11; },
                    Gender       : function() { return 'F'; },
                    Description  : function() { return 'Indian'; }
                  }
};

defaultVoice = vwVoices.Susan;

vwVoices.isValid = function(v) {
    var result = true;
    ['EngineId','LangId','VoiceId'].forEach(function(method){
        if (v[method] === undefined){
            result = false;
        }
    });
    return result;
};

vwVoices.defaultVoice = function(v){
    if (v){
        if (!this.isValid(v)){
            throw new TypeError('voice is not valid');
        }
        defaultVoice = v;
    }
    return defaultVoice;
};


module.exports.createAuthToken = function(){
    var tokenData;

    if (!arguments[0]){
        throw new SyntaxError('createAuthToken expects object or path to token json file.');
    }

    if ((typeof arguments[0].valueOf())  === 'string'){
        var fdata;
        try {
            fdata = fs.readFileSync(arguments[0]);
        } catch(e){
            throw new Error('read token file failed: ' + e.message);
        }
        try {
            tokenData = JSON.parse(fdata);
        }catch(e){
            throw new TypeError('unable to parse json from token file: ' + e.message);
        }
    } else {
        tokenData = arguments[0];
    }

    if (tokenData.apiId === undefined) {
        throw new SyntaxError('token is missing apiId');
    }
    if (tokenData.accountId === undefined) {
        throw new SyntaxError('token is missing accountId');
    }
    if (tokenData.secret === undefined) {
        throw new SyntaxError('token is missing secret');
    }

    return {
        getApiId     : function() { return tokenData.apiId;     },
        getAccountId : function() { return tokenData.accountId; },
        getSecret    : function() { return tokenData.secret;    }
    };
};

module.exports.createRequest = function(){
    var obj = {
            authToken   : null,
            engineId    : defaultVoice.EngineId(),
            langId      : defaultVoice.LangId(),
            voiceId     : defaultVoice.VoiceId(),
            text        : null,
            ext         : 'mp3',
            fxType      : null,
            fxLevel     : null,
            session     : null
    };

    if (arguments[0]){
        var arg = arguments[0];
        Object.keys(obj).forEach(function(key){
            if (arg[key]){
                obj[key] = arg[key];
            }
        });
    }

    obj.say = function(txt,voice){
        if (voice) {
            var v;
            if ((typeof voice.valueOf()) == 'string'){
                v = vwVoices[voice]; 
            } else {
                if (!vwVoices.isValid(voice)){
                    throw new TypeError('voice is not valid');
                }
                v = voice;
            }
            this.engineId   = v.EngineId();
            this.langId     = v.LangId();
            this.voiceId    = v.VoiceId();
        }
        
        if (!txt){
            throw new TypeError('text parameter required');
        }
        this.text = txt;


        return this;
    };

    obj.checksum = function(){
        var reqmd5  = crypto.createHash('md5');

        if (this.authToken === null) { throw new Error('authToken is required'); }
        if (this.engineId  === null) { throw new Error('engineId is required'); }
        if (this.langId    === null) { throw new Error('langId is required'); }
        if (this.voiceId   === null) { throw new Error('voiceId is required'); }
        if (this.text      === null) { throw new Error('text is required'); }

        reqmd5.update(
            this.engineId   +
            this.langId     +
            this.voiceId    +   
            this.text       +     
            this.ext        + 
            ((this.fxType === null)  ? '' : this.fxType) +
            ((this.fxLevel === null) ? '' : this.fxLevel) +
            this.authToken.getAccountId() +
            this.authToken.getApiId() +
            ((this.session === null) ? '' : this.session) +
            this.authToken.getSecret()
        );

        return reqmd5.digest('hex');
    };

    obj.toHttpOpts = function(){
        var data = {
            EID         : this.engineId,
            LID         : this.langId,
            VID         : this.voiceId,   
            TXT         : this.text,     
            EXT         : this.ext, 
            FX_TYPE     : ((this.fxType === null)  ? '' : this.fxType),
            FX_LEVEL    : ((this.fxLevel === null) ? '' : this.fxLevel),
            ACC         : this.authToken.getAccountId(),
            API         : this.authToken.getApiId(),
            SESSION     : ((this.session === null) ? '' : this.session),
            CS          : this.checksum()
        };

        return = {
            hostname : 'www.vocalware.com',
            port     : 80,
            path     : '/tts/gen.php?' + qs.stringify(data),
            method   : 'GET'
        };
    };
};


module.exports.textToSpeech = function(rqs,output,cb){



};

module.exports.voices = vwVoices;
