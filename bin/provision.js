var request = require('request'),
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
}

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
    app.log(' #Download QA environment');
    app.log(' $ cheftogo environment QA');
    app.log('');
    app.log('');
    app.log('Downloads QA environment, writes default_attributes to attributes.json,');
    app.log('environment cookbook versions are downloaded, along with data bags.');
}

app.parseCmdLine = function(state){
    var cmdl = require('commander'),
        deferred = q.defer();
    
    function doPrompt(prompt, defaultVal){
        var def = q.defer(), method = 'prompt';
        if (prompt.toLowerCase().match(/password/)){
            method = 'password';
        }
        cmdl[method].call(cmdl,prompt,function(res){
            def.resolve(res || defaultVal);
        });
        return def.promise;
    }
    
    if (!state.config){
        state.config = {};
    }

    cmdl
//        .option('-p, --password [pwd]','Password, or prompt for password','./')
        .option('-s, --server [URL]','API Host.','https://staging.cinema6.com')
////        .option('-u, --user [$USER]','User name.',process.env.USER)
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

            state.task = {
                method : app.createUser,
                data   : {}
            };
           
            app.log('Will create user.');
            doPrompt('Username: ')
            .then(function(name){
                return state.task.data.username = name;
            })
            .then(function(){
                if (!state.task.data.password){
                    return doPrompt('Password: ')
                    .then(function(pw){
                        state.task.data.password = pw;
                    })
                    .then(function(){
                        return doPrompt('Repeat Password: ');
                    })
                    .then(function(pw){
                        if (pw !== state.task.data.password){
                            throw new Error('Passwords do not match!');
                        }
                    });
                }
                return '';
            })
            .then(function(){
                var org = 'o-' + uuid.createUuid().substr(0,14);
                return doPrompt('Organization [' + org + ']: ', org);
            })
            .then(function(org){
                return state.task.data.organization = org;
            })
            .then(function(){
                return deferred.resolve(state);
            })
            .catch(function(err){
                return deferred.reject(err);
            });
        });
    cmdl
        .parse(process.argv);

    return deferred.promise;
};

app.qrequest = function(opts){
    var deferred = q.defer();
  
    opts.uri = host + opts.uri;
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
}

app.login = function(state){
    app.log('login ' + username);
    var opts  = {
            method : 'POST',
            uri     : '/api/auth/login',
            jar     : true,
            json : {
                email   : state.username,
                password: state.password
            }
        };
  
    return qrequest(opts);
}

app.createUser = function(username,password,org){
    app.log('create ' + username);
    var opts  = {
            method : 'POST',
            uri     : '/api/account/user',
            jar     : true,
            json : {
                email   : username,
                password: password,
                org : 'o-272dad8355526d'
            }
        };
  
    return qrequest(opts);
}

app.parseCmdLine(state)
    /*
app.login(state)
.then(function(){
    return app.createUser('jglickman@cinema6.com','password');
})
*/
.then(function(result){
    app.log(JSON.stringify(result,null,3));
    process.exit(0);
})
.catch(function(err){
    app.log('Error: ' + err.message);
    process.exit(1);
});
