var fs      = require('fs-extra'),
    path    = require('path'),
    q       = require('q'),
    aws     = require('aws-sdk');

module.exports = function (grunt) {

    var initProps = {
            packageInfo : grunt.file.readJSON('package.json'),
            awsAuth     : grunt.option('awsAuth') || path.join(process.env.HOME,'.aws.json')
        };

    initProps.name = function() {
        return this.packageInfo.name;
    };
    
    require('load-grunt-config')(grunt, {
        configPath: path.join(__dirname, 'tasks/options'),
        config: {
            settings: initProps
        }
    });
    grunt.loadTasks('tasks');
    
    
    grunt.registerTask('default', function(){
        grunt.task.run('jshint');
        grunt.task.run('unit_tests');
    });

    grunt.registerTask('ec2_tests', function(svc){
        grunt.task.run('ec2data');
        if (svc){
            grunt.task.run('e2e_tests:' + svc);
        } else {
            grunt.task.run('e2e_tests');
        }
    });
    
};

