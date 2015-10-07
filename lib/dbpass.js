var fs   = require('fs'),
    os   = require('os'),
    path = require('path'),
    lib  = {};

lib.open = function(){
    /*jslint bitwise: true */
    var filePath = arguments[0] || path.join(process.env.HOME,'.pgpass'),
        perms    = fs.statSync(filePath).mode & 0777,
        lines, data, result;

    if ((perms !== 0400) && (perms !== 0600)){
        throw new Error('Password file is not adequately secured.');
    }

    try {
        lines = fs.readFileSync(filePath).toString().split(os.EOL);
    } catch(e){
        throw new Error('Password file content cannot be parsed.');
    }

    if ((!lines) || (lines.length === 0) || (lines.length === 1 && lines[0] === '')){
        throw new Error('Password file has no content.');
    }

    lines.forEach(function(line){
        var fields;
        line  = line.replace(/^\s*(\S*)\s*$/,'$1');
        if ((line.charAt(0) === '#') || (line === '')){
            return;
        }

        fields = line.split(':');

        if (fields.length !== 5) {
            throw new Error('dbpass parse error: bad field count.');
        }

        if (!data) {
            data = [];
        }

        data.push( {
            hostname : fields[0],
            port     : fields[1],
            database : fields[2],
            username : fields[3],
            password : fields[4]
        });
    });

    if (!data){
        throw new Error('dbpass parse error: no data found.');
    }

    result = function(hostname,port,database,username){
        var i = 0, len = data.length, item;
        function match(a,b){ return ((a === '*') || (a === b)); }
        for (i = 0; i < len; i++){
            item = data[i];
            if (match(item.hostname, hostname || '*') &&
                match(String(item.port), String(port || '*')) &&
                match(item.database, database || '*') &&
                match(item.username, username || '*') ) {
                return item.password;
            }
        }
    };

    result.data = data;

    return result;
};

module.exports = lib;
