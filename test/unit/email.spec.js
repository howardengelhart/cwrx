var flush = true;
describe('email', function() {
    var path, email, q, handlebars, nodemailer, sesTransport, htmlToText;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        path            = require('path');
        email           = require('../../lib/email');
        handlebars      = require('handlebars');
        nodemailer      = require('nodemailer');
        htmlToText      = require('html-to-text');
        fs              = require('fs-extra');
        q               = require('q');
    });

    describe('notifyPwdChange', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').and.returnValue(q('success'));
        });

        it('should correctly call compileAndSend', function(done) {
            email.notifyPwdChange('send', 'recip').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send','recip',
                    'Your account password has been changed','pwdChange.html',{contact:'send'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT A PROBLEM'));
            email.notifyPwdChange('send', 'recip').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('sendActivationEmail', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').and.returnValue(q('success'));
        });

        it('should correctly call compileAndSend', function(done) {
            email.sendActivationEmail('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send','recip',
                    'Your account is almost activated!','activationEmail.html',{contact:'send', link: 'link'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.sendActivationEmail('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('notifyAccountActivation', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').and.returnValue(q('success'));
        });

        it('should correctly call compileAndSend', function(done) {
            email.notifyAccountActivation('send', 'recip').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send', 'recip', 'Your account has been activated!',
                    'userActivation.html', {contact: 'send'});
            }).catch(function(error) {
                expect(error,toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.sendActivationEmail('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error sending email');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('notifyMultipleLoginAttempts', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').and.returnValue(q('success'));
        });

        it('should correctly call compileAndSend', function(done) {
            email.notifyMultipleLoginAttempts('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send', 'recip', 'Need help logging in?',
                    'suggestPasswordReset.html', {contact: 'send', link: 'link'});
            }).catch(function(error) {
                expect(error,toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.notifyMultipleLoginAttempts('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error sending email');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('compileAndSend', function() {
        var compilerSpy, fakeTransport, sesTportSpy;
        beforeEach(function() {
            delete require.cache[require.resolve('../../lib/email')];
            sesTportSpy = jasmine.createSpy('ses-transport').and.returnValue('fakeSesTport');
            require.cache[require.resolve('nodemailer-ses-transport')] = { exports: sesTportSpy };
            email = require('../../lib/email');
            spyOn(fs, 'readFile').and.callFake(function(path, opts, cb) { cb(null, 'templateHtml'); });
            compilerSpy = jasmine.createSpy('handlebars compiler').and.returnValue('compiledHtml');
            spyOn(handlebars, 'compile').and.returnValue(compilerSpy);
            fakeTransport = {
                sendMail: jasmine.createSpy('transport.sendMail').and.callFake(function(opts, cb) {
                    cb(null, 'success');
                })
            };
            spyOn(nodemailer, 'createTransport').and.returnValue(fakeTransport);
            spyOn(htmlToText, 'fromString').and.returnValue('compiledText');
        });

        it('should successfully compile the template and send an email', function(done) {
            email.compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).toBe('success');
                expect(fs.readFile).toHaveBeenCalledWith(path.join(__dirname, '../../templates/templ'),
                                                         {encoding: 'utf8'}, jasmine.any(Function));
                expect(handlebars.compile).toHaveBeenCalledWith('templateHtml');
                expect(compilerSpy).toHaveBeenCalledWith({foo: 'bar'});
                expect(htmlToText.fromString).toHaveBeenCalledWith('compiledHtml');
                expect(sesTportSpy).toHaveBeenCalledWith();
                expect(nodemailer.createTransport).toHaveBeenCalledWith('fakeSesTport');
                expect(fakeTransport.sendMail).toHaveBeenCalledWith({from:'sender',to:'recip',
                    subject:'subj',html:'compiledHtml',text:'compiledText'}, jasmine.any(Function));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if reading the template fails', function(done) {
            fs.readFile.and.callFake(function(path, opts, cb) { cb('I GOT A PROBLEM'); });
            email.compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.readFile).toHaveBeenCalled();
                expect(handlebars.compile).not.toHaveBeenCalled();
                expect(htmlToText.fromString).not.toHaveBeenCalled();
                expect(sesTportSpy).not.toHaveBeenCalled();
                expect(nodemailer.createTransport).not.toHaveBeenCalled();
                expect(fakeTransport.sendMail).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if sending the email fails', function(done) {
            fakeTransport.sendMail.and.callFake(function(opts, cb) { cb('I GOT A PROBLEM'); });
            email.compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.readFile).toHaveBeenCalled();
                expect(handlebars.compile).toHaveBeenCalled();
                expect(htmlToText.fromString).toHaveBeenCalled();
                expect(sesTportSpy).toHaveBeenCalledWith();
                expect(nodemailer.createTransport).toHaveBeenCalled();
                expect(fakeTransport.sendMail).toHaveBeenCalled();
            }).done(done);
        });
    });
});
