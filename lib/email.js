(function(){
    'use strict';

    var q               = require('q'),
        fs              = require('fs-extra'),
        path            = require('path'),
        nodemailer      = require('nodemailer'),
        sesTransport    = require('nodemailer-ses-transport'),
        htmlToText      = require('html-to-text'),
        handlebars      = require('handlebars'),
        email = {};

    email.notifyPwdChange = function(sender, recipient) {
        var subject = 'Your account password has been changed',
            data = { contact: sender };
        return email.compileAndSend(sender, recipient, subject, 'pwdChange.html', data);
    };

    email.sendActivationEmail = function(sender, recipient, activationLink) {
        var subject = 'Your account is almost activated!',
            data = {
                contact: sender,
                link: activationLink
            };
        return email.compileAndSend(sender, recipient, subject, 'activationEmail.html', data);
    };

    email.notifyAccountActivation = function(sender, recipient) {
        var subject = 'Your account has been activated!',
            data = {
                contact: sender
            };
        return email.compileAndSend(sender, recipient, subject, 'userActivation.html', data);
    };

    email.compileAndSend = function(sender, recipient, subject, template, data) {
        var templPath = path.join(__dirname, '../templates', template);
        return q.npost(fs, 'readFile', [templPath, {encoding: 'utf8'}])
        .then(function(template) {
            var compiled = handlebars.compile(template)(data),
                opts = {
                    from: sender,
                    to: recipient,
                    subject: subject,
                    html: compiled,
                    text: htmlToText.fromString(compiled),
                };
            return q.npost(nodemailer.createTransport(sesTransport()), 'sendMail', [opts]);
        });
    };

    module.exports = email;
}());
