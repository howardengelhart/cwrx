#!/usr/bin/env node
var bcrypt    = require('bcrypt'),
    spawn     = require('child_process').spawn,
    fs        = require('fs'),
    os        = require('os'),
    path      = require('path'),
    cmdl      = require('commander'),
    makeid    = require('../lib/uuid').createUuid,
    dbserver  = 'dv-mongo1.corp.cinema6.com',
    dbuser    = '',
    user      = '',
    password  = 'Password1',
    lastUpdated = (new Date()).toISOString(),
    script, scriptPath, cmdl;


cmdl
    .option('--db-server <servername>'  , 'Db server (' + dbserver + ')', dbserver)
    .option('--db-user <logonid>'       , 'User name for database.')
    .option('--password <password>'     , 'Reset Cinema6 password (' + password + ')',password)
    .option('--user <username>'         , 'Cinema6 username')
    .parse(process.argv);

dbserver = cmdl.dbServer;
dbuser   = cmdl.dbUser;
user     = cmdl.user.toLowerCase();
password = bcrypt.hashSync(cmdl.password,bcrypt.genSaltSync());

script = [  'c6Db=db.getSiblingDB("c6Db");',
                'c6Db.users.update({email:"' + user + '"},',
                '{$set:{password:"' + password + '",',
                'lastUpdated:"' + lastUpdated + '"}});',
                'cursor=c6Db.users.find({email:"' + user + '"});',
                'printjson( cursor.next() );'
            ].join('');

scriptPath = path.join(os.tmpdir(),makeid() + '.js');

fs.writeFileSync(scriptPath,script);
spawn('mongo',[dbserver + '/admin',scriptPath,'-u',dbuser,'-p'],{ stdio : 'inherit' })
    .on('close',function(){
        fs.unlinkSync(scriptPath);
        process.exit();
    });



