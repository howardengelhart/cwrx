#!/usr/bin/env node

var fs       = require('fs'),
    path     = require('path'),
    program  = require('commander'),
    mux      = (path.join(__dirname,'../../mux')),
    request, template;

program
    .version('0.0.1')
    .option('-v, --video-type [type]', 'Specify video mime type [video/mp4]','video/mp4')
    .parse(process.argv);

if (!program.args[0]){
    exitApp('Expected a template file.',1);
}

try {
    template = loadTemplateFromFile(program.args[0]);
} catch (e) {
    exitApp('Load template failed with: ' + e.message, 1);
}

try {
    if (program.args[1]){
        request = loadRequestFromFile(program.args[1]);    
    }
} catch (e){
    exitApp('Load request failed with: ' + e.message, 1);
}

if (!request) {
    exitApp('Need a request',1);
}

if (!request.srcType) {
    request.srcType = program.videoType;
}

function xxx() {

    this.interpolateTemplates = function(data) {
        var annoLength = this.model.annotations.length;
        $log.info('Interpolate ' + annoLength + ' annotations with ' + data.length + ' responses.');
        for (var i = 0; i < annoLength; i++) {
            var a = this.model.annotations[i];
            a.text = this.interpolate(a.template,data);
            $log.info('Annotation [' + i + ']: ' + a.text);
        }
    };

}

/*
 * The Help
 *
 */

function exitApp (msg,resultCode){
    if (msg){
        if (resultCode){
            console.error(msg);
        } else {
            console.log(msg);
        }
    }
    process.exit(resultCode);
};


function loadTemplateFromFile(tmplFile){
    var tmplObj = JSON.parse(fs.readFileSync(tmplFile));

    if (!(tmplObj.annotations instanceof Object)){
        throw new SyntaxError('Template is missing annotations section');
    }

    if ((!(tmplObj.annotations.notes instanceof Array)) || (!tmplObj.annotations.notes.length)){
        throw new SyntaxError('Template is missing notes section');
    }

    return tmplObj;
}

function loadRequestFromFile(rqsFile){
    var rqsObj = JSON.parse(fs.readFileSync(rqsFile));

    if ((!(rqsObj.responses instanceof Array)) || (!rqsObj.responses.length)){
        throw new SyntaxError('Request is missing responses section');
    }
    
    return rqsObj;
}

function interpolate (tmpl,data) {
    var patt  = /\${(\d+)}/,
        dataLen,
        match;

    if (!data) {
        return tmpl;
    }

    if ((data instanceof Array) === false) {
        throw new TypeError('Data parameter must be an array.'); 
    }

    dataLen = data.length;
    while((match = patt.exec(tmpl)) !== null) {
        var idx = (match[1] - 1);
        if (idx < 0) {
            throw new RangeError('Template parameters should start at ${1}');
        }
        if (idx >= dataLen) {
            throw new RangeError('Invalid template parameter (too high): ' + match[0]);
        }
        tmpl = tmpl.replace(match[0],data[idx]);
    }
    return tmpl;
};

