#!/usr/bin/env node
var program = require('commander'),
    path    = require('path'),
    fs      = require('fs-extra'),
    os      = require('os'),
    cp      = require('child_process'),
    vw      = require('../lib/vocalware');

try {
    main(function(rc){
        process.exit(rc);    
    });
} catch(e){
    console.log(e);
    process.exit(1);
}

function vwOpts(val){
    var nvp = val.split('=');
    if (nvp[0] === 'fx'){
        program.vwOpts[nvp[0]] = nvp[1];
    } else {
        program.vwOpts[nvp[0]] = parseInt(nvp[1],10);
    }
}

function main(done){
    var defaultAuthFile = path.join(process.env.HOME,'.tts.json'),
        defaultVoice    = vw.voices.defaultVoice(),
        defaultOpts = '-o eid=' + defaultVoice.EngineId() + ' ' +
                      '-o lid=' + defaultVoice.LangId() + ' ' +
                      '-o vid=' + defaultVoice.VoiceId(),
//                      '-o fx=<none>' + 
//                      '-o level=<none>', 
        rqs,
        authToken,m;

    program.vwOpts = {
        eid : defaultVoice.EngineId(),
        lid : defaultVoice.LangId(),
        vid : defaultVoice.VoiceId(),
        fx  : null,
        level: null
    };

    program
        .usage('[options] <text>')
        .version('1.0.0')
        .option('-a, --auth-file [path]',
                'Location of the vocalware auth-file (' + defaultAuthFile + ')',defaultAuthFile)
        .option('-o, --opt [name=val]',
                'Vocalware options.. (' + defaultOpts + ')',vwOpts)
        .option('-f, --file [file] ',
                'Specify the output mp3 file.','result.mp3')
        .option('--duration [n3,n2,n1,1,2,3]', 'Duration "D" fx' )
        .option('--list-voices','List available voices')
        .option('--pitch [n3,n2,n1,1,2,3]', 'Pitch "P" fx' )
        .option('--robotic', 'Robotic "R" fx.')
        .option('--speed [n3,n2,n1,1,2,3]', 'Speed "S" fx' )
        .option('--time [1,2,3,4]', 'Time "T" fx', parseInt)
        .option('--voice [voice] ', 'Specify a voice by name')
        .option('--whisper [1,2,3]', 'Whisper "W" fx', parseInt)
        .on('--help', function(){
            console.log('  Examples:');
            console.log('');
            console.log('  #Use the default voice (Susan)');
            console.log('     $ vware.js "This is a test"');
            console.log('');
            console.log('  #Use a different engine and voice - the hard way');
            console.log('     $ vware.js -o eid=6 -o vid=19 "This is the tipsy voice."');
            console.log('');
            console.log('  #Use a different engine and voice - the easy way');
            console.log('     $ vware.js --voice=Tipsy "This is the tipsy voice."');
            console.log('');
            console.log('  #Talk like you are on the phone.');
            console.log('     $ vware.js --voice=Paul --robotic "I am speaking to you over the telephone."');
            console.log('');
        })
        .parse(process.argv);

    if (program.listVoices){
        var voices = [];
        for (var voice in vw.voices){
            if (vw.voices[voice].EngineId){
                voices.push(voice);
            }
        }
        voices.sort().forEach(function(voice){
            console.log('  ',voice);
        });
        return done(0);
    }

    if (program.voice){
        var theVoice = vw.voices[program.voice];
        if (!theVoice){
            console.log('*** - Invalid voice: ' + program.voice);
            return done(1);
        }
        program.vwOpts.eid = theVoice.EngineId();
        program.vwOpts.lid = theVoice.LangId();
        program.vwOpts.vid = theVoice.VoiceId();
    }

    if (program.duration){
        program.vwOpts.fx  = 'D';
        m = program.duration.match(/(n*)(\d)/);
        if (!m){
            console.log('*** ' + program.duration  + ' is not a valid duration setting.');
            return done(1);
        }
        program.vwOpts.level= parseInt(m[2]);
        if (m[1] === 'n'){
            program.vwOpts.level *= -1;
        }
    }
    
    if (program.pitch){
        program.vwOpts.fx  = 'P';
        m = program.pitch.match(/(n*)(\d)/);
        if (!m){
            console.log('*** ' + program.pitch  + ' is not a valid pitch setting.');
            return done(1);
        }
        program.vwOpts.level= parseInt(m[2]);
        if (m[1] === 'n'){
            program.vwOpts.level *= -1;
        }
    }
    
    if (program.robotic){
        program.vwOpts.fx  = 'R';
        program.vwOpts.level= 3;
    }
    
    if (program.speed){
        program.vwOpts.fx  = 'S';
        m = program.speed.match(/(n*)(\d)/);
        if (!m){
            console.log('*** ' + program.speed  + ' is not a valid speed setting.');
            return done(1);
        }
        program.vwOpts.level= parseInt(m[2]);
        if (m[1] === 'n'){
            program.vwOpts.level *= -1;
        }
    }
    
    if (program.time){
        program.vwOpts.fx  = 'T';
        program.vwOpts.level= program.time;
    }
    
    if (program.whisper){
        program.vwOpts.fx  = 'W';
        program.vwOpts.level= program.whisper;
    }

    if (!program.args[0]){
        program.outputHelp();
        console.log('*** You must provide text for vocalware');
        return done(1);
    }

    if ((program.file === 'result.mp3') && fs.existsSync(program.file)){
        fs.deleteSync(program.file);
    }

    try {
        authToken = vw.createAuthToken(program.authFile);
    } catch(e){
        program.outputHelp();
        console.log('*** ' + e.message);
        return done(1);
    }

    rqs = vw.createRequest({
        authToken   : authToken,
        engineId    : program.vwOpts.eid,
        langId      : program.vwOpts.lid,
        voiceId     : program.vwOpts.vid,
        text        : program.args[0],
        ext         : 'mp3',
        fxType      : program.vwOpts.fx,
        fxLevel     : program.vwOpts.level,
        session     : null
    });
  
    vw.textToSpeech(rqs,program.file,function(err,rqs,o){
        if (err) {
            console.log(err.message);
            done(1);
        } else {
            if (os.platform() === 'darwin'){
                cp.exec('afplay ' + program.file,function(){
                    if (program.file === 'result.mp3'){
                        fs.deleteSync(program.file);
                    }
                    done(0);
                });
            } else {
                done(0);
            }
        }
    });
    return;
}

