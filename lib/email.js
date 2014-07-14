(function(){
    'use strict';

    var q               = require('q'),
        fs              = require('fs-extra'),
        path            = require('path'),
        nodemailer      = require('nodemailer'),
        handlebars      = require('handlebars'),
        email = {};
    
    email.notifyEmailChange = function(sender, recipient, newEmail) {
        var subject = 'Your account email address has been changed',
            data = { newEmail: newEmail, contact: sender };
        return email._compileAndSend(sender, recipient, subject, 'emailChange.html', data);
    };
    
    email.notifyPwdChange = function(sender, recipient) {
        var subject = 'Your account password has been changed',
            data = { contact: sender };
        return email._compileAndSend(sender, recipient, subject, 'pwdChange.html', data);
    };
    
    email._compileAndSend = function(sender, recipient, subject, template, data) {
        var templPath = path.join(__dirname, '../templates', template);
        return q.npost(fs, 'readFile', [templPath, {encoding: 'utf8'}])
        .then(function(template) {
            var compiled = handlebars.compile(template)(data),
                opts = {
                    from: sender,
                    to: recipient,
                    subject: subject,
                    html: compiled,
                    generateTextFromHTML: true
                };
            return q.npost(nodemailer.createTransport('SES'), 'sendMail', [opts]);
        });
    };

    module.exports = email;
}());
