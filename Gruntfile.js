module.exports = function (grunt) {

    initProps = {
      msg :   'this is a test!' 
    };
  
    grunt.initConfig({
        props : initProps
    });
    
    grunt.registerTask('install', 'Install the release.', function(){
        grunt.log.writeln('Installing the module: ' + 
            grunt.config.get('props.msg') );
    });

};

