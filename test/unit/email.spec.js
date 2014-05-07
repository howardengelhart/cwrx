var flush = true;
describe('s3util', function() {
    var email, q;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        email           = require('../../lib/email');
        q               = require('q');
    });
    
    describe('sendTemplate', function() {
        var emailTemplates, makeTemplate;
        beforeEach(function() {
            makeTemplate = function(templateName, data, cb) {
                cb(null, '<b>Hey Dood</b>', 'Hey Dood');
            };
            emailTemplates = function(templateDir, cb) {
                cb(null, makeTemplate);
            };
            require.cache[require.resolve('email-templates')] = emailTemplates;
            spyOn(email, 'send').andReturn(q('i did that thang'));
        });
        
        xit('should successfully render and send an email', function(done) {
        
        });
        
        // xit('should fail if sending
        
        //TODO: should do some real testing of emailTemplates here (check that templates render without errors and properly, etc.
    });
    
    describe('send', function() {
        var ses, addrParams, subject, bodyParams;
        beforeEach(function() {
            ses = {
                sendEmail: jasmine.createSpy('ses.sendEmail').andCallFake(function(params, cb) {
                    cb(null, 'i did that thang');
                })
            };
            addrParams = { sender: 'sender@c6.com', recipient: 'recipient@c6.com' };
            subject = 'yo dawg';
            bodyParams = { html: '<b>Hey Dood</b>', text: 'Hey Dood' };
        });
        
        it('should reject if not passed the required params', function(done) {
            q.allSettled([
                email.send(null, addrParams, subject, bodyParams),
                email.send(ses, null, subject, bodyParams),
                email.send(ses, addrParams, null, bodyParams),
                email.send(ses, addrParams, subject, null),
            ]).then(function(results) {
                results.forEach(function(result) {
                    expect(result.state).toBe('rejected');
                    expect(result.reason).toBe('Must include addrParams, subject, bodyParams, and ses');
                });
                done();
            }).catch(function(error) {
                expect(error.toString()).toBeDefined();
                done();
            });
        });
        
        it('should successfully send an email', function(done) {
            email.send(ses, addrParams, subject, bodyParams).then(function(data) {
                expect(data).toBe('i did that thang');
                expect(ses.sendEmail).toHaveBeenCalled();
                expect(ses.sendEmail.calls[0].args[0]).toEqual({
                    Source: 'sender@c6.com',
                    ReturnPath: 'sender@c6.com',
                    Destination: { ToAddresses: [ 'recipient@c6.com' ] },
                    Message: {
                        Body: { Text: { Data: 'Hey Dood' }, Html: { Data: '<b>Hey Dood</b>' } },
                        Subject: { Data: 'yo dawg' }
                    }
                });
                done();
            }).catch(function(error) {
                expect(error.toString()).toBeDefined();
                done();
            });
        });
        
        it('should fail if sending the email fails', function(done) {
            ses.sendEmail.andCallFake(function(params, cb) { cb('I GOT A PROBLEM', 'data'); });
            email.send(ses, addrParams, subject, bodyParams).then(function(data) {
                expect(data).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(ses.sendEmail).toHaveBeenCalled();
                done();
            });
        });
    });
});

