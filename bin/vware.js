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
    program.vwOpts[nvp[0]] = parseInt(nvp[1],10);
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
        authToken;

    program.vwOpts = {
        eid : defaultVoice.EngineId(),
        lid : defaultVoice.LangId(),
        vid : defaultVoice.VoiceId(),
        fx  : null,
        level: null
    };

    program
        .usage('[options] <text>')
        .version('0.0.1')
        .option('-a, --auth-file [path]',
                'Location of the vocalware auth-file (' + defaultAuthFile + ')',defaultAuthFile)
        .option('-o, --opt [name=val]',
                'Vocalware options.. (' + defaultOpts + ')',vwOpts)
        .option('-f, --file [file] ',
                'Specify the output mp3 file.','result.mp3')
        .on('--help', function(){
            console.log('  Examples:');
            console.log('');
            console.log('  #Use the default voice (Susan)');
            console.log('     $ vware.js "This is a test"');
            console.log('');
            console.log('  #Use a different engine and voice');
            console.log('     $ vware.js -o eid=6 -o vid=19 "This is the tipsy voice."')
            console.log('');
        })
        .parse(process.argv);

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

