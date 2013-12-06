var fs      = require('fs'),
    qs      = require('querystring'),
    http    = require('http'),
    crypto  = require('crypto'),
    vwVoices,
    defaultVoice;

vwVoices = {
    Susan       : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 1; }
    },
    Dave        : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 2; }
    },
    Elizabeth   : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 4; }
    },
    Simon       : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 5; }
    },
    Catherine   : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 6; }
    },
    Allison     : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 7; }
    },
    Steven      : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 8; }
    },
    Alan        : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 9; }
    },
    Grace       : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 10; }
    },
    Veena       : {
        EngineId     : function() { return 2; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 11; }
    },
    Kate       : {
        EngineId     : function() { return 3; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 1; }
    },
    Paul       : {
        EngineId     : function() { return 3; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 2; }
    },
    Julie       : {
        EngineId     : function() { return 3; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 3; }
    },
    Bridget     : {
        EngineId     : function() { return 3; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 4; }
    },
    LargeMale	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 1; }
    },
    GiantMale	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 2; }
    },
    Male	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 3; }
    },
    Female	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 4; }
    },
    Child	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 5; }
    },
    OldWoman	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 6; }
    },
    Robotoid	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 7; }
    },
    Martian	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 8; }
    },
    Munchkin	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 9; }
    },
    Colossus	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 10; }
    },
    MellowFemale     : {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 11; }
    },
    MellowMale	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 12; }
    },
    CrispMale	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 13; }
    },
    FastFred	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 15; }
    },
    Troll	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 16; }
    },
    Nerd	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 17; }
    },
    MilkToast	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 18; }
    },
    Tipsy	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 19; }
    },
    Choirboy	: {
        EngineId     : function() { return 6; },
        LangId       : function() { return 1; },
        VoiceId      : function() { return 20; }
    }
};

defaultVoice = vwVoices.Susan;

vwVoices.isValid = function(v) {
    var result = true;
    ['EngineId','LangId','VoiceId'].forEach(function(method){
        if (v[method] === undefined){
            result = false;
            throw new TypeError('voice is not valid, missing method "' + method + '"');
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

    if (tokenData.accountId === undefined) {
        throw new SyntaxError('token is missing accountId');
    }
    if (tokenData.secret === undefined) {
        throw new SyntaxError('token is missing secret');
    }

    return {
        getApiId     : function() { return tokenData.apiId;     },
        getAccountId : function() { return tokenData.accountId; },
        getSecret    : function() { return tokenData.secret;    },
        getService   : function() { return tokenData.service;   }
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
            session     : null,
            service     : undefined,
            serviceHostName : undefined
        };

    if (arguments[0]){
        var arg = arguments[0];
        Object.keys(obj).forEach(function(key){
            if (arg[key]){
                obj[key] = arg[key];
            }
        });
    }

    if (obj.service === undefined){
        if ((obj.authToken !== null) && (obj.authToken.getService() !== undefined)) {
            obj.service = obj.authToken.getService(); 
        } else {
            obj.service = 'vocalware';    
        }
    }

    if (obj.service.toLowerCase() === 'vocalware') {
        if (obj.serviceHostName === undefined) {
            obj.serviceHostName = 'www.vocalware.com';
        }
    } else
    if (obj.service.toLowerCase() === 'oddcast') {
        if (obj.serviceHostName === undefined) {
            obj.serviceHostName = 'cache.oddcast.com';
        }
    } else {
        throw new Error('invalid service: "' + obj.service + '"');
    }

    obj.say = function(txt,voice){
        if (voice) {
            var v;
            if ((typeof voice.valueOf()) == 'string'){
                v = vwVoices[voice];
                if (v === undefined){
                    throw new Error('invalid voice: "' + voice + '"');
                }
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
        var reqmd5  = crypto.createHash('md5'), apiId;

        if (this.authToken === null) { throw new Error('authToken is required'); }
        if (this.engineId  === null) { throw new Error('engineId is required'); }
        if (this.langId    === null) { throw new Error('langId is required'); }
        if (this.voiceId   === null) { throw new Error('voiceId is required'); }
        if (this.text      === null) { throw new Error('text is required'); }

        reqmd5.update(
            this.engineId.toString()   +
            this.langId.toString()     +
            this.voiceId.toString()    +
            this.text       +
            this.ext        +
            ((this.fxType === null)  ? '' : this.fxType.toString()) +
            ((this.fxLevel === null) ? '' : this.fxLevel.toString()) +
            this.authToken.getAccountId() +
            ((this.authToken.getApiId() === undefined) ? '' : this.authToken.getApiId()) +
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

        if (!this.authToken.getApiId()){
            delete data.API;
        }

        return {
            hostname : this.serviceHostName,
            port     : 80,
            path     : '/tts/gen.php?' + qs.stringify(data),
            method   : 'GET'
        };
    };

    return obj;
};


module.exports.textToSpeech = function(rqs,output,cb){
    var httpReq, opts,
        cberr = function(msg){
        process.nextTick(function(){
            cb({
                    message : msg,
                    toString : function() { return this.message; }
                },rqs,null);
        });
    };

    if (fs.existsSync(output)){
        return cberr('File already exists: ' + output);
    }

    try {
        opts = rqs.toHttpOpts();
    }catch(e){
        return cberr(e.message);
    }

    //console.log('opts: ' + JSON.stringify(opts,null,3));
    httpReq = http.request(opts,function(res){
        //console.log('STATUS: ' + res.statusCode + ', ' + JSON.stringify(res.headers,null,3));
        if (((res.statusCode >= 200) && (res.statusCode < 300)) &&
            (res.headers['content-type'] === 'audio/mpeg')) {
            var f = fs.createWriteStream(output);
            res.on('data',function(chunk){
                f.write(chunk);
            });

            res.on('end',function(){
                f.end();
            });

            f.on('close',function(){
                cb(null,rqs,output);
            });
        } else
        if ((res.headers['content-type'].match(/^text/)) ||
            (res.headers['content-type'] === 'application/json')) {

            var err = 'request error: ';
            res.on('data',function(chunk){
                err += chunk;
            });

            res.on('end',function(){
                process.nextTick(function(){
                    cberr(err);
                });
            });
        } else {
            cberr('unexpected response from vocalware. status=' + res.statusCode +
                                    ', headers=' + JSON.stringify(res.headers));
        }
    });

    httpReq.on('error',function(e){
        cberr(e.message);
    });

    httpReq.end();
};

module.exports.voices = vwVoices;
