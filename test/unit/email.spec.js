var flush = true;
describe('email', function() {
    var path, email, q, fs, handlebars, nodemailer, sesTransport, htmlToText, logger, mockLog, Status;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        path            = require('path');
        handlebars      = require('handlebars');
        nodemailer      = require('nodemailer');
        htmlToText      = require('html-to-text');
        fs              = require('fs-extra');
        q               = require('q');
        email           = require('../../lib/email');
        logger          = require('../../lib/logger');
        Status          = require('../../lib/enums').Status;

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        spyOn(email, 'compileAndSend').and.returnValue(q('success'));
    });

    beforeEach(function() {
        jasmine.clock().install();
    });
    
    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('updateApproved', function() {
        it('should correctly call compileAndSend', function(done) {
            email.updateApproved('send', 'recip', false, 'ketchupbot', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Your Campaign Change Request Has Been Approved',
                    'campaignUpdateApproved.html',
                    { campName: 'ketchupbot', dashboardLink: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should send a different message if this was the campaign\'s initial submit', function(done) {
            email.updateApproved('send', 'recip', true, 'ketchupbot', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Reelcontent Campaign Approved',
                    'campaignApproved.html',
                    { campName: 'ketchupbot', dashboardLink: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.updateApproved('send', 'recip', false, 'ketchupbot', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('updateRejected', function() {
        it('should correctly call compileAndSend', function(done) {
            email.updateRejected('send', 'recip', false, 'ketchupbot', 'link', 'you stink').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Your Campaign Change Request Has Been Rejected',
                    'campaignUpdateRejected.html',
                    { campName: 'ketchupbot', dashboardLink: 'link', rejectionReason: 'you stink' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should send a different message if this was the campaign\'s initial submit', function(done) {
            email.updateRejected('send', 'recip', true, 'ketchupbot', 'link', 'you stink').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Reelcontent Campaign Rejected',
                    'campaignRejected.html',
                    { campName: 'ketchupbot', dashboardLink: 'link', rejectionReason: 'you stink' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.updateRejected('send', 'recip', false, 'ketchupbot', 'link', 'you stink').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('campaignEnded', function() {
        it('should correctly call compileAndSend', function(done) {
            var now = new Date();
            email.campaignEnded('send', 'recip', 'best campaign', Status.Expired, 'dash.board', 'manage.this').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Your Campaign Has Ended',
                    'campaignExpired.html',
                    {
                        campName: 'best campaign',
                        dashboardLink: 'dash.board',
                        manageLink: 'manage.this',
                        date: now.toLocaleDateString()
                    },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should send a different message if the campaign is out of budget', function(done) {
            var now = new Date();
            email.campaignEnded('send', 'recip', 'best campaign', Status.OutOfBudget, 'dash.board', 'manage.this').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Your Campaign is Out of Budget',
                    'campaignOutOfBudget.html',
                    {
                        campName: 'best campaign',
                        dashboardLink: 'dash.board',
                        manageLink: 'manage.this',
                        date: now.toLocaleDateString()
                    },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.campaignEnded('send', 'recip', 'best campaign', Status.Expired, 'dash.board', 'manage.this').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('newUpdateRequest', function() {
        it('should correctly call compileAndSend', function(done) {
            email.newUpdateRequest('send', 'recip', 'user@c6.com', 'Heinz', 'ketchupbot', 'review.me').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'New update request from Heinz for campaign "ketchupbot"',
                    'newUpdateRequest.html',
                    { userEmail: 'user@c6.com', campName: 'ketchupbot', reviewLink: 'review.me' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.newUpdateRequest('send', 'recip', 'user@c6.com', 'Heinz', 'ketchupbot', 'review.me').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('activateAccount', function() {
        it('should correctly call compileAndSend', function(done) {
            email.activateAccount('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Welcome to Reelcontent Video Ads!',
                    'activateAccount.html',
                    { activationLink: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT 99 PROBLEMS AND THIS IS ONE'));
            email.activateAccount('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT 99 PROBLEMS AND THIS IS ONE');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('accountWasActivated', function() {
        it('should correctly call compileAndSend', function(done) {
            email.accountWasActivated('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Your Account is Now Active',
                    'accountWasActivated.html',
                    { dashboardLink: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.accountWasActivated('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error sending email');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('passwordChanged', function() {
        it('should correctly call compileAndSend', function(done) {
            var now = new Date();
            jasmine.clock().mockDate(now);
            email.passwordChanged('send', 'recip', 'support').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Reelcontent Password Change Notice',
                    'passwordChanged.html',
                    { contact: 'support', date: now.toLocaleDateString(), time: now.toTimeString() },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('I GOT A PROBLEM'));
            email.passwordChanged('send', 'recip', 'support').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('emailChanged', function() {
        it('should correctly call compileAndSend', function(done) {
            email.emailChanged('send', 'oldEmail', 'oldEmail', 'newEmail', 'support').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'oldEmail',
                    'Your Email Has Been Changed',
                    'emailChanged.html',
                    { newEmail: 'newEmail', contact: 'support' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should include the oldEmail in the data if sending to the newEmail', function(done) {
            email.emailChanged('send', 'newEmail', 'oldEmail', 'newEmail', 'support').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'newEmail',
                    'Your Email Has Been Changed',
                    'emailChanged.html',
                    { newEmail: 'newEmail', oldEmail: 'oldEmail', contact: 'support' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.emailChanged('send', 'recip', 'newEmail', 'support').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error sending email');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('failedLogins', function() {
        it('should correctly call compileAndSend', function(done) {
            email.failedLogins('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Reelcontent: Multiple-Failed Logins',
                    'failedLogins.html',
                    { link: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.failedLogins('send', 'recip', 'link').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error sending email');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('resetPassword', function() {
        it('should correctly call compileAndSend', function(done) {
            email.resetPassword('send', 'recip', 'link').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith(
                    'send',
                    'recip',
                    'Forgot Your Password?',
                    'passwordReset.html',
                    { resetLink: 'link' },
                    [{ filename: 'logo.png', cid: 'reelContentLogo' }]
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.and.returnValue(q.reject('error sending email'));
            email.resetPassword('send', 'recip', 'link').then(function(resp) {
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
        
        describe('if there are all-caps links in the text', function() {
            it('should convert the links to lowercase', function(done) {
                htmlToText.fromString.and.returnValue('Yo go here: [HTTP://CINEMA6.COM]\n\nWait no go here: [HTTPS://reelcontent.COM/FOO?TOKEN=ASDF1234]');
                
                email.compileAndSend('sender','recip','subj','templ',{foo:'bar'}).then(function(resp) {
                    expect(resp).toBe('success');
                    expect(fakeTransport.sendMail).toHaveBeenCalledWith({
                        from: 'sender',
                        to: 'recip',
                        subject: 'subj',
                        html: 'compiledHtml',
                        text: 'Yo go here: [http://cinema6.com]\n\nWait no go here: [https://reelcontent.com/foo?token=asdf1234]'
                    }, jasmine.any(Function));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if there are attachments provided', function() {
            var attachments;
            beforeEach(function() {
                spyOn(fs, 'existsSync').and.returnValue(true);
                attachments = [
                    { filename: 'pic1.jpg', cid: 'picNumbah1' },
                    { filename: 'pic2.png', cid: 'picNumbah2' }
                ];
            });
            
            it('should add them to the options for sendMail', function(done) {
                email.compileAndSend('sender', 'recip', 'subj', 'templ', { foo:'bar' }, attachments).then(function(resp) {
                    expect(resp).toBe('success');
                    expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../templates/assets/pic1.jpg'));
                    expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../templates/assets/pic2.png'));
                    expect(fakeTransport.sendMail).toHaveBeenCalledWith({
                        from: 'sender',
                        to: 'recip',
                        subject: 'subj',
                        html: 'compiledHtml',
                        text: 'compiledText',
                        attachments: [
                            { filename: 'pic1.jpg', cid: 'picNumbah1', path: path.join(__dirname, '../../templates/assets/pic1.jpg') },
                            { filename: 'pic2.png', cid: 'picNumbah2', path: path.join(__dirname, '../../templates/assets/pic2.png') }
                        ]
                    }, jasmine.any(Function));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should warn and ignore any files that cannot be found', function(done) {
                fs.existsSync.and.callFake(function(path) {
                    if (/pic1/.test(path)) return false;
                    else return true;
                });
                email.compileAndSend('sender', 'recip', 'subj', 'templ', { foo:'bar' }, attachments).then(function(resp) {
                    expect(resp).toBe('success');
                    expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../templates/assets/pic1.jpg'));
                    expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../templates/assets/pic2.png'));
                    expect(fakeTransport.sendMail).toHaveBeenCalledWith({
                        from: 'sender',
                        to: 'recip',
                        subject: 'subj',
                        html: 'compiledHtml',
                        text: 'compiledText',
                        attachments: [
                            { filename: 'pic2.png', cid: 'picNumbah2', path: path.join(__dirname, '../../templates/assets/pic2.png') }
                        ]
                    }, jasmine.any(Function));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
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
