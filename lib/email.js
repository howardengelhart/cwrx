(function(){
    'use strict';

    var q               = require('q'),
        fs              = require('fs-extra'),
        path            = require('path'),
        nodemailer      = require('nodemailer'),
        sesTransport    = require('nodemailer-ses-transport'),
        htmlToText      = require('html-to-text'),
        handlebars      = require('handlebars'),
        logger          = require('./logger'),
        email = {};

    // Campaign update request has been approved; different email if it was an initial submit
    email.updateApproved = function(sender, recipient, isInitial, campName, link) {
        var data = {
            campName: campName,
            dashboardLink: link
        }, subject, template;

        if (isInitial) {
            subject = 'ReelContent Campaign Approved';
            template = 'campaignApproved.html';
        } else {
            subject = 'Your Campaign Change Request Has Been Approved';
            template = 'campaignUpdateApproved.html';
        }
        
        return email.compileAndSend(
            sender,
            recipient,
            subject,
            template,
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };

    // Campaign update request has been rejected; different email if it was an initial submit
    email.updateRejected = function(sender, recipient, isInitial, campName, link, reason) {
        var data = {
            campName: campName,
            dashboardLink: link,
            rejectionReason: reason
        }, subject, template;

        if (isInitial) {
            subject = 'ReelContent Campaign Rejected';
            template = 'campaignRejected.html';
        } else {
            subject = 'Your Campaign Change Request Has Been Rejected';
            template = 'campaignUpdateRejected.html';
        }

        return email.compileAndSend(
            sender,
            recipient,
            subject,
            template,
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };
    
    // New campaign update request for support to review
    email.newUpdateRequest = function(sender, recipient, userEmail, campName, reviewLink) {
        var data = {
            userEmail: userEmail,
            campName: campName,
            reviewLink: reviewLink
        };

        return email.compileAndSend(
            sender,
            recipient,
            'New campaign update request',
            'newUpdateRequest.html',
            data
        );
    };

    // Email with link to activate a newly-created account
    email.activateAccount = function(sender, recipient, activationLink) {
        var data = { activationLink: activationLink };

        return email.compileAndSend(
            sender,
            recipient,
            'Welcome to ReelContent Video Ads!',
            'activateAccount.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };

    // Confirmation that user's account has been created
    email.accountWasActivated = function(sender, recipient, dashboardLink) {
        var data = { dashboardLink: dashboardLink };

        return email.compileAndSend(
            sender,
            recipient,
            'Your Account is Now Active',
            'accountWasActivated.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };

    // Notification that user's password has been changed
    email.passwordChanged = function(sender, recipient, contact) {
        var changeDate = new Date(),
            data = {
                contact: contact,
                date: changeDate.toLocaleDateString(),
                time: changeDate.toTimeString()
            };

        return email.compileAndSend(
            sender,
            recipient,
            'ReelContent Password Change Notice',
            'passwordChanged.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };
    
    // Notification that user's email has been changed (sent to old email address)
    email.emailChanged = function(sender, recipient, newEmail, contact) {
        var data = {
                newEmail: newEmail,
                contact: contact
            };

        return email.compileAndSend(
            sender,
            recipient,
            'Your Email Has Been Changed',
            'emailChanged.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };

    // Notification that multiple failed logins recorded for user's account. Link is to page in
    // frontend where user can begin password reset process.
    email.failedLogins = function(sender, recipient, resetPasswordLink) {
        var data = { link: resetPasswordLink };

        return email.compileAndSend(
            sender,
            recipient,
            'ReelContent: Multiple-Failed Logins',
            'failedLogins.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };
    
    // Email with special link to reset a forgotten password, including a token.
    email.resetPassword = function(sender, recipient, resetLink) {
        var data = { resetLink: resetLink };

        return email.compileAndSend(
            sender,
            recipient,
            'Forgot Your Password?',
            'passwordReset.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };
    

    // Sends email from sender to recipient, rendering the template file using the supplied data
    // attachments is optional and should be an array of objects with `filename` + `cid` fields
    email.compileAndSend = function(sender, recipient, subject, template, data, attachments) {
        var log = logger.getLog(),
            templPath = path.join(__dirname, '../templates', template);

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
                
            if (attachments) {
                opts.attachments = attachments.map(function(obj) {
                    obj.path = path.join(__dirname, '../templates/assets', obj.filename);
                    return obj;
                })
                .filter(function(obj) {
                    if (!fs.existsSync(obj.path)) {
                        log.warn('Attachment file %1 not found', obj.path);
                        return false;
                    }
                    return true;
                });
            }

            return q.npost(nodemailer.createTransport(sesTransport()), 'sendMail', [opts]);
        });
    };

    module.exports = email;
}());
