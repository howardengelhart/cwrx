var fs   = require('fs-extra'),
    path = require('path');

module.exports = function (grunt) {

    var initProps = {
            prefix      : process.env.HOME,
            dist        : path.join(__dirname,'dist'),
            packageInfo : grunt.file.readJSON('package.json')
        };

    initProps.version     = function(){
        return this.gitLastCommit.commit;
    };

    initProps.name        = function() {
        return this.packageInfo.name;
    };

    initProps.installDir = function() {
        return (this.name() + '.' +
                this.gitLastCommit.date.toISOString().replace(/\W/g,'') + '.' +
                this.gitLastCommit.commit);
    };
    initProps.installPath = function(){
        return (path.join(this.prefix, 'releases', this.installDir()));
    };
    initProps.linkPath = function(){
        return path.join(this.prefix, 'services' );
    };
    initProps.distVersionPath= function() {
        return path.join(this.dist, this.gitLastCommit.commit);
    };

    grunt.initConfig({
        settings   : initProps,

        jasmine_node: {
            match   : '(core|av|^util).*',
            matchAll : true,
            projectRoot   : './test',
            jUnit: {
                report: true,
                savePath : __dirname + '/reports/',
                useDotNotation : true,
                consolidate : true
            }
        },

        jshint: {
            options: {
                jshintrc: 'jshint.json'
            },
            all: [
                __dirname + '/bin/{,*/}*.js',
                __dirname + '/lib/{,*/}*.js'
            ]
        },
        
        watch: {
            scripts: {
                files: [
                    __filename,
                    __dirname + '/bin/**/*.js',
                    __dirname + '/lib/**/*.js',
                    __dirname + '/test/**/*.js' 
                ],
                tasks: ['jshint', 'jasmine_node']
            }
        },
        
        copy    : {
            release : { 
                files:  [
                            { 
                                expand: true, 
                                dest: '<%= settings.installPath() %>', 
                                src: [ 'bin/*', 'lib/**', 'config/*', 'node_modules/**', 'package.json', 'README.md' ] 
                            }
                        ]
               }
        },

        link : {
                options : {
                    overwrite: true,
                    force    : true,
                    mode     : '755'
                },
                service : {
                    target : '<%= settings.installPath() %>',
                    link   : path.join('<%= settings.linkPath() %>','<%= settings.packageInfo.name %>')
                },
                dub : {
                    target : path.join('<%= settings.installPath() %>','bin','dub.js'),
                    link   : path.join('<%= settings.installPath() %>','bin','dub')
                },
                dubcli : {
                    target : path.join('<%= settings.installPath() %>','bin','dubcli.js'),
                    link   : path.join('<%= settings.installPath() %>','bin','dubcli')
                }
        },

        rmbuild : {
            history : 2 
        },

        service : {
            main : { services :     [ 'dub' ] }
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-jasmine-node');

    grunt.registerTask('default', function(){
        grunt.task.run('jshint');
        grunt.task.run('jasmine_node');
    });

    grunt.registerTask('install', 'Install', function(){
        grunt.task.run('gitLastCommit');
        grunt.task.run('installCheck');
        grunt.task.run('mvbuild');
        grunt.task.run('link');
        if (require('os').platform() === 'linux'){
            grunt.task.run('service');
        }
        grunt.task.run('installCleanup');
    });
    
    grunt.registerTask('installCleanup', [
        'gitLastCommit',
        'rmbuild'
    ]);
    
    grunt.registerTask('installCheck', 'Install check', function(){
        var settings = grunt.config.get('settings'),
            installPath = settings.installPath();

        if (fs.existsSync(installPath)){
            grunt.log.errorlns('Install dir (' + installPath +
                                ') already exists.');
            return false;
        }
    });

    grunt.registerTask('gitLastCommit','Get a version number using git commit', function(){
        var settings = grunt.config.get('settings'),
            done = this.async(),
            handleVersionData = function(data){
                if ((data.commit === undefined) || (data.date === undefined)){
                    grunt.log.errorlns('Failed to parse version.');
                    return done(false);
                }
                data.date = new Date(data.date * 1000);
                settings.gitLastCommit = data;
                grunt.log.writelns('Last git Commit: ' +
                    JSON.stringify(settings.gitLastCommit,null,3));
                grunt.config.set('settings',settings);
                return done(true);
            };

        if (settings.gitLastCommit){
            return done(true);
        }

        if (grunt.file.isFile('version.json')){
            return handleVersionData(grunt.file.readJSON('version.json'));
        }

        grunt.util.spawn({
            cmd     : 'git',
            args    : ['log','-n1','--format={ "commit" : "%h", "date" : "%ct" , "subject" : "%s" }']
        },function(err,result){
            if (err) {
                grunt.log.errorlns('Failed to get gitLastCommit: ' + err);
                return done(false);
            }
            handleVersionData(JSON.parse(result.stdout));
        });
    });

    grunt.registerTask('gitstatus','Make surethere are no pending commits', function(){
        var done = this.async();
        grunt.util.spawn({
            cmd     : 'git',
            args    : ['status','--porcelain']
        },function(err,result){
            if (err) {
                grunt.log.errorlns('Failed to get git status: ' + err);
                done(false);
            }
            if (result.stdout === '""'){
                grunt.log.writelns('No pending commits.');
                done(true);
            }
            grunt.log.errorlns('Please commit pending changes');
            grunt.log.errorlns(result.stdout.replace(/\"/g,''));
            done(false);
        });
    });
    
    grunt.registerTask('mvbuild', 'Move the build to a release folder.', function(){
        if (grunt.config.get('moved')){
            grunt.log.writeln('Already moved!');
            return;
        }
        var settings = grunt.config.get('settings'),
            installPath = settings.installPath();
        grunt.log.writeln('Moving the module to ' + installPath);
        grunt.task.run('copy:release');
        grunt.config.set('moved',true);
    });
    
    grunt.registerMultiTask('link', 'Link release apps.', function(){
        var opts = grunt.config.get('link.options'),
            data = this.data;

        if (!opts) {
            opts = {};
        }

        if (!data.options){
            data.options = {};
        }

        if (!opts.mode){
            opts.mode = '0755';
        }

        if (opts){
            Object.keys(opts).forEach(function(opt){
                if (data.options[opt] === undefined){
                    data.options[opt] = opts[opt];
                }
            });
        }

        if (data.options.overwrite === true){
            try {
                grunt.log.writelns('Removing old link: ' + data.link);
                fs.unlinkSync(data.link);
            } catch(e){
                if (! e.message.match(/ENOENT, no such file or directory/) ){
                    grunt.log.errorlns('Hh:' + e.message);
                }
            }
        }

        if (data.options.force){
            var linkDir = path.dirname(data.link);
            if (!fs.existsSync(linkDir)){
                grunt.log.writelns('Creating linkDir: ' + linkDir);
                grunt.file.mkdir(linkDir, '0755');
            }
        }

        grunt.log.writelns('Create link: ' + data.link + ' ==> ' + data.target);
        fs.symlinkSync(data.target, data.link);

        grunt.log.writelns('Make link executable.');
        fs.chmodSync(data.link,data.options.mode);

        grunt.log.writelns(data.link + ' is ready.');
    });
    
    grunt.registerTask('rmbuild','Remove old copies of the install',function(){
        this.requires(['gitLastCommit']);
        var settings       = grunt.config.get('settings'),
            installBase = settings.name(),
            installPath = settings.installPath(),
            installRoot = path.dirname(installPath),
            pattPart = new RegExp(installBase),
            pattFull = new RegExp(installBase +  '.(\\d{8})T(\\d{9})Z'),
            history     = grunt.config.get('rmbuild.history'),
            contents = [];

        if (history === undefined){
            history = 4;
        }
        grunt.log.writelns('Max history: ' + history);

        fs.readdirSync(installRoot).forEach(function(dir){
            if (pattPart.test(dir)){
                contents.push(dir);
            }
        });

        if (contents){
            var sorted = contents.sort(function(A,B){
                var mA = pattPart.exec(A),
                    mB = pattPart.exec(B),
                    i;
                // The version is the same
                mA = pattFull.exec(A);
                mB = pattFull.exec(B);
                if (mA === null) { return 1; }
                if (mB === null) { return -1; }
                for (i = 1; i <= 2; i++){
                    if (mA[i] !== mB[i]){
                        return mA[i] - mB[i];
                    }
                }
                return 1;
            });
            while (sorted.length > history){
                var dir = sorted.shift();
                grunt.log.writelns('remove: ' + dir);
                fs.removeSync(path.join(installRoot,dir));
            }
        }
    });

    grunt.registerMultiTask('service','Send service restart', function(){
        var opts = grunt.config.get('service.options'),
            data = this.data,
            done = this.async,
            retval = true,
            results = 0;

        if (!opts) {
            opts = {};
        }

        if (!data.options){
            data.options = {};
        }

        if (!opts.command){
            opts.command = 'restart';
        }

        if (!opts.servicePath){
            opts.servicePath = '/sbin/service';
        }
    
        if (opts){
           Object.keys(opts).forEach(function(opt){
                if (data.options[opt] === undefined){
                    data.options[opt] = opts[opt];
                }
           });
        }

        data.services.forEach(function(service){
            grunt.log.writelns('will: service ' + service + ' ' + data.options.command);
            grunt.util.spawn({
                cmd : data.options.servicePath,
                args: [service,data.options.command]
            },function(err,result,code){
                if ((err) || (code !== 0)){
                    grunt.log.errorlns('service error on ' + service + ': ' + err);
                    retval = false;
                }

                if (result){
                    grunt.log.writelns('RESULT: ' + result);
                }

                if (++results === data.services.length){
                    done(retval);
                }
            });
        });
    });
    

};

