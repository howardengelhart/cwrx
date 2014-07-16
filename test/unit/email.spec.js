var flush = true;
describe('email', function() {
    var path, email, q, handlebars, nodemailer;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        path            = require('path');
        email           = require('../../lib/email');
        handlebars      = require('handlebars');
        nodemailer      = require('nodemailer');
        fs              = require('fs-extra');
        q               = require('q');
    });

    describe('_compileAndSend', function() {
        var compilerSpy, fakeTransport;
        beforeEach(function() {
            spyOn(fs, 'readFile').andCallFake(function(path, opts, cb) { cb(null, 'templateHtml'); });
            compilerSpy = jasmine.createSpy('handlebars compiler').andReturn('compiledHtml');
            spyOn(handlebars, 'compile').andReturn(compilerSpy);
            fakeTransport = {
                sendMail: jasmine.createSpy('transport.sendMail').andCallFake(function(opts, cb) {
                    cb(null, 'success');
                })
            };
            spyOn(nodemailer, 'createTransport').andReturn(fakeTransport);
        });

        it('should successfully compile the template and send an email', function(done) {
            email._compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).toBe('success');
                expect(fs.readFile).toHaveBeenCalledWith(path.join(__dirname, '../../templates/templ'),
                                                         {encoding: 'utf8'}, jasmine.any(Function));
                expect(handlebars.compile).toHaveBeenCalledWith('templateHtml');
                expect(compilerSpy).toHaveBeenCalledWith({foo: 'bar'});
                expect(nodemailer.createTransport).toHaveBeenCalledWith('SES');
                expect(fakeTransport.sendMail).toHaveBeenCalledWith({from:'sender',to:'recip',
                    subject:'subj',html:'compiledHtml',generateTextFromHTML:true}, jasmine.any(Function));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if reading the template fails', function(done) {
            fs.readFile.andCallFake(function(path, opts, cb) { cb('I GOT A PROBLEM'); });
            email._compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.readFile).toHaveBeenCalled();
                expect(handlebars.compile).not.toHaveBeenCalled();
                expect(nodemailer.createTransport).not.toHaveBeenCalled();
                expect(fakeTransport.sendMail).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if sending the email fails', function(done) {
            fakeTransport.sendMail.andCallFake(function(opts, cb) { cb('I GOT A PROBLEM'); });
            email._compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.readFile).toHaveBeenCalled();
                expect(handlebars.compile).toHaveBeenCalled();
                expect(nodemailer.createTransport).toHaveBeenCalled();
                expect(fakeTransport.sendMail).toHaveBeenCalled();
            }).finally(done);
        });
    });
});

