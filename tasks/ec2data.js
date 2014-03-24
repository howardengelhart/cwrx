var aws     = require('aws-sdk'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {

    grunt.registerMultiTask('ec2data', 'launches ec2 instances', function() {
        var auth     = settings.awsAuth,
            done     = this.async(),
            ec2      = null,
            tag      = grunt.option('tag');

        if (!tag){
            grunt.log.errorlns('Tag is required, use --tag.');
            return done(false);
        }

        aws.config.loadFromPath(auth);
        
        config.ec2 = new aws.EC2();
        
        helpers.getEc2InstanceData({ ec2 : ec2, params : {
            Filters : [ {
                Name   : 'tag:Lock' ,
                Values : [tag]
            } ]
        }})
        .then(function(results){
            grunt.config.set('ec2Data',results); 
            done(true);
        })
        .catch(function(err){
            grunt.log.errorlns(err.message);
            done(false);
        });
    });
};
