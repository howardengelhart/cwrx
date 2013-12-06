var crypto      = require('crypto'),
    q           = require('q'),
    fs          = require('fs-extra'),
    path        = require('path'),
    exec        = require('child_process').exec,
    vocalWare   = require('../../lib/vocalware'),
    ffmpeg      = require('../../lib/ffmpeg'),
    id3Info     = require('../../lib/id3'),
    uuid        = require('../../lib/uuid').createUuid,
    testVoices  = (function(){
        return fs.readJsonSync(path.join(__dirname,'voices.json'));
    }()),
    testToken   = (function(){
       return fs.readJsonSync(process.env['E2E_TTS_TOKEN_FILE']);
    }()),
    testService = testToken.service;

var dataDump = {};

/////////////////////////
// Helpers for q
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

function getId3Info(params){
    var deferred = q.defer();
    id3Info(params.resultFile,function(err,result){
        if (err) {
            return deferred.reject(err);
        }
        params.resultId3Info = result;
        
        return deferred.resolve(params);
    });
    return deferred.promise;
}

function stripId3Tags(params){
    var deferred = q.defer();
    id3.id3Strip(params.resultFile,function(err,result){
        if (err) {
            return deferred.reject(err);
        }
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

function backupResultMp3(params){
    var deferred = q.defer();
    exec('cp ' + params.resultFile + ' ' + params.resultFile + '.bak',function(error,stdout,stderr){
        if (error){
            deferred.reject(error);
            return;
        }
   
        deferred.resolve(params);
    });
    return deferred.promise;
}

/////////////////////////
// The tests
describe('tts_' + testService + '_e2e_', function() {
    var workSpace = path.join('ws','e2e',uuid().substr(0,10));
    beforeEach(function(){
        fs.mkdirsSync(workSpace);
    });
    describe('voices',function(){
        var authToken;
        beforeEach(function(){
            authToken = vocalWare.createAuthToken(testToken); 
        });

        it('should sound like we expect',function(done){
            q.all(testVoices.voices.map(function(voiceConfig){
                var request, voicePrint, fileName;
                request = vocalWare.createRequest({
                    authToken : authToken,
                    service   : testService
                });

                request.say(voiceConfig.test,voiceConfig.voice);

                voicePrint = voiceConfig.voice.toLowerCase();

                if (voiceConfig.fxType){
                    request.fxType = voiceConfig.fxType;
                    voicePrint += '_' + request.fxType.toLowerCase();
                }
            
                if (voiceConfig.fxLevel){
                    request.fxLevel = voiceConfig.fxLevel;
                    voicePrint += '_' + request.fxLevel.toString();
                }
                
                fileName = path.join( workSpace,testService + '_' + voicePrint + '.mp3');
            
                return textToSpeech({
                    ttsRequest  : request,
                    voiceCfg    : voiceConfig,
                    requestFile  : fileName
                });
            }))
            .then(function(results){
                return q.all(results.map(function(params){
                    return getId3Info(params);
                }));
            })
            .then(function(results){
                var dataDump = { voices : [] }; 
                console.log('Evaluate run:',workSpace);
                expect(results.length).toEqual(testVoices.voices.length);
                results.forEach(function(result){
                    var o_id3Info = result.voiceCfg.id3Info,
                        r_id3Info = result.resultId3Info;
                    expect(r_id3Info.audio_duration).toEqual(o_id3Info.audio_duration);
                    expect(r_id3Info.kbps).toEqual(o_id3Info.kbps);
                    expect(r_id3Info.khz).toEqual(o_id3Info.khz);
                    expect(r_id3Info.lips).toEqual(o_id3Info.lips);
                    expect(r_id3Info.phonemes).toEqual(o_id3Info.phonemes);
                });
                done();
            })
            .fail(function(err){
                done(err);
            });
        },10000);
    });
});
