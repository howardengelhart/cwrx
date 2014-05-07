var request = require('request'),
    path    = require('path'),
    fs      = require('fs-extra'),
    q       = require('q'),
    uuid   = require('../lib/uuid'),
    app     = {},
    state   = {};

app.log = function(){
    var args = Array.prototype.slice.call(arguments, 0);
    args.push('\n');
    process.stdout.write(args.join(' '));
};

app.getVersion  = function(){
    return 1;
};

function showUsageUser(sub){
    app.log('');
    app.log('Usage:');
    app.log(' provision user');
    app.log('');
    if (sub === 'create'){

    } else {
        app.log(' Users associated api tasks.  Current list includes:');
        app.log('   * create');
        app.log('');
        app.log(' user help <task> will provide additional detail.');
        app.log('');
    }

    app.log('Example:');
    app.log('');
    app.log(' #Create a user');
    app.log(' $ node bin/provision.js user create');
    app.log('');
    app.log('');
    app.log('Downloads QA environment, writes default_attributes to attributes.json,');
    app.log('environment cookbook versions are downloaded, along with data bags.');
}

function doPrompt(prompt, defaultVal){
    var def = q.defer(), method = 'prompt';
    if (prompt.toLowerCase().match(/password/)){
        method = 'promptPassword';
    }
    state.cmdl[method].call(state.cmdl,prompt,function(res){
        def.resolve(res || defaultVal);
    });
    return def.promise;
}

app.parseCmdLine = function(state){
    var cmdl = state.cmdl = require('commander');
    
    if (!state.login){
        state.login = {
            'id'      : null,
            'password' : null
        };
    }

    cmdl.promptPassword = cmdl.password;
    
    var provData, authFile = path.join(process.env.HOME,'.c6prov.json');
    if (fs.existsSync(authFile)){
        try {
            provData = fs.readJsonSync(authFile);
            cmdl.username = provData.username;
            cmdl.password = provData.password;
        }catch(e){
            app.log('Unable to read ' +  authFile);
        }
    }
    
    cmdl
        .option('-u, --username [email]','Logon.')
        .option('-s, --server [URL]','API Host.','https://staging.cinema6.com')
        .version(app.getVersion());
    cmdl
        .command('help')
        .description('Help [command]')
        .action(function(cmd){
            if (cmd === 'user'){
                showUsageUser();
            } else {
                app.log('Command <' + cmd + '> is not recognized.');
            }
            process.exit(0);
        });
    cmdl
        .command('user')
        .description('Manage users')
        .action(function(subcommand,data){
            if (arguments.length === 1) {
                showUsageUser();
                process.exit(1);
            }

            if (subcommand === 'help'){
                showUsageUser(data);
                process.exit(1);
            }

            if (data === 'help'){
                showUsageUser(subcommand);
                process.exit(1);
            }

            state.task = app.createUser;
           
        });
    cmdl
        .parse(process.argv);


    return q(state);
};

app.qrequest = function(opts){
    var deferred = q.defer();
  
    opts.uri = state.cmdl.server + opts.uri;
    request(opts,function(error, response, body){
        if (error){
            deferred.reject(error);
            return;
        }

        if ((response.statusCode < 200) || (response.statusCode >= 300)){
            deferred.reject({
                statusCode : response.statusCode,
                response   : response.body
            });
            return;
        }

        deferred.resolve(body);
    });
    

    return deferred.promise;
};

app.login = function(state){
    var loginId, password;
    return (function(){
            if (state.cmdl.username) {
                return q(state.cmdl.username);
            }
            return doPrompt('Email : ');
        }())
        .then(function(logon){
            loginId = logon;
            if (state.cmdl.password) {
                return state.cmdl.password;
            }
            return doPrompt('Your Password: ');
        })
        .then(function(pwd){
            password = pwd;
            app.log('login ' + loginId);
            var opts  = {
                    method : 'POST',
                    uri     : '/api/auth/login',
                    jar     : true,
                    json : {
                        email   : loginId,
                        password: password
                    }
                };
          
            return app.qrequest(opts);
        })
        .then(function(/*result*/){
            return state;
        });
};

app.createUser = function(/*state*/){
    var userName, password, orgId;
    app.log('Will create user.');

    return doPrompt('User Email: ')
    .then(function(email){
        userName = email;
        return doPrompt('Password: ');
    })
    .then(function(pwd){
        password = pwd;
        return doPrompt('Repeat Password: ');
    })
    .then(function(pw){
        if (pw !== password){
            throw new Error('Passwords do not match!');
        }
        var org = 'o-' + uuid.createUuid().substr(0,14);
        return doPrompt('Organization [' + org + ']: ', org);
    })
    .then(function(org){
        orgId = org;
        return orgId;
    })
    .then(function(){
        app.log('create ' + userName);
        var opts  = {
                method : 'POST',
                uri     : '/api/account/user',
                jar     : true,
                json : {
                    email   : userName,
                    password: password,
                    org : orgId
                }
            };
      
        return app.qrequest(opts);
    });
};

app.parseCmdLine(state)
.then(function(state){
    if (!state.task){
        return q.reject(new Error('Need to define a task!'));
    }
    return app.login(state);
})
.then(function(state){
    return state.task.apply(null,state);
})
.then(function(result){
    app.log(JSON.stringify(result,null,3));
    process.exit(0);
})
.catch(function(err){
    if (err.message) {
        app.log('Error: ' + err.message);
    } else {
        app.log('Error: ' + JSON.stringify(err,null,3));
    }
    process.exit(1);
});
