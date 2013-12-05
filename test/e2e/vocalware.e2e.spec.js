var crypto      = require('crypto'),
    q           = require('q'),
    fs          = require('fs-extra'),
    path        = require('path'),
    vocalWare   = require('../../lib/vocalware'),
    uuid        = require('../../lib/uuid').createUuid,
    testToken   = (function(){
       return fs.readJsonSync(process.env['E2E_TTS_TOKEN_FILE']);
    }()),
    testService = testToken.service;

    
var testVoices = [
    {
        voice : "Susan",
        test  : "Hello, my name is Susan.",
        md5   : "593c925da0473ac96e6e8d0a1b1d4152"
    },
    {
        voice : "Dave",
        test  : "Hello, my name is Dave.",
        md5   : "4a30afdef798077a166403366f96cbd1"
    },
    {
        voice : "Elizabeth",
        test  : "Hello, my name is Elizabeth.",
        md5   : "607520d997d52196400941ad7cb82883"
    },
    {
        voice : "Simon",
        test  : "Hello, my name is Simon.",
        md5   : "07bebaa6ecd6b698ef5b34df9a74a2c3"
    },
    {
        voice : "Catherine",
        test  : "Hello, my name is Catherine.",
        md5   : "36fb48117c73b7ac078c5627c52124de"
    },
    {
        voice : "Allison",
        test  : "Hello, my name is Allison.",
        md5   : "7044a6d670e66d8524ff9f1dcb5a6eba"
    },
    {
        voice : "Steven",
        test  : "Hello, my name is Steven.",
        md5   : "a8ad4def28efafc8c41c7eac6340f7c5"
    },
    {
        voice : "Alan",
        test  : "Hello, my name is Alan.",
        md5   : "939a262bfd872e6945710910777ffd37"
    },
    {
        voice : "Grace",
        test  : "Hello, my name is Grace.",
        md5   : "ddccc0e046c3fa4bf91e6eda39dce407"
    },
    {
        voice : "Veena",
        test  : "Hello, my name is Veena.",
        md5   : "134b528241dde60f13230c33dbe1d118"
    },
    {
        voice : "Kate",
        test  : "Hello, my name is Kate.",
        md5   : "e5d7fb865ea76b402d107d94a80482d6"
    },
    {
        voice : "Paul",
        test  : "Hello, my name is Paul.",
        md5   : "37d58b4c0a570abab2547ccb91cebb73"
    },
    {
        voice : "Julie",
        test  : "Hello, my name is Julie.",
        md5   : "fdc14fda70775cd0e6f8d8bc24be2592"
    },
    {
        voice : "Bridget",
        test  : "Hello, my name is Bridget.",
        md5   : "da400b58b2a62e03fd1418e638392f4e"
    }
];

function textToSpeech(params){
    var deferred = q.defer();
    vocalWare.textToSpeech(params.ttsRequest,params.requestFile,function(err,rqs,result){
        if (err){
            return deferred.reject(err);
        }
        params.resultFile = result;
        return deferred.resolve(params);
    });
    return deferred.promise;
}

function getCheckSum(params){
    var contents = fs.readFileSync(params.resultFile),
        hash = crypto.createHash('md5');
    hash.update(contents);
    params.resultMD5 = hash.digest('hex');
    return params;
}

describe('tts_' + testService + '_e2e_', function() {
    var workSpace = path.join('ws','e2e',uuid().substr(0,10));
    beforeEach(function(){
        fs.mkdirsSync(workSpace);
    });
    describe('api',function(){
        var authToken;
        beforeEach(function(){
            authToken = vocalWare.createAuthToken(testToken); 
        });

        it('should do something',function(done){
            q.all(testVoices.map(function(voiceConfig){
                var request, fileName;
                fileName = path.join(
                    workSpace,testService + '_' + voiceConfig.voice.toLowerCase() + '.mp3');
                request = vocalWare.createRequest({
                    authToken : authToken,
                    service   : testService
                });

                request.say(voiceConfig.test,voiceConfig.voice);
            
                return textToSpeech({
                    ttsRequest  : request,
                    voiceCfg    : voiceConfig,
                    requestFile  : fileName
                });
            }))
            .then(function(results){
                return q.all(results.map(function(params){
                    return getCheckSum(params);
                }));
            })
            .then(function(results){
                expect(results.length).toEqual(testVoices.length);
                results.forEach(function(result){
                    expect(result.resultMD5).toEqual(result.voiceCfg.md5);
                });
                done();
            })
            .fail(function(err){
                done(err);
            });
        },10000);
    });
});
