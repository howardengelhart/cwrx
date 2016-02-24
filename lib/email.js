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
        Status          = require('./enums').Status,
        email = {};

    // Campaign update request has been approved; different email if it was an initial submit
    email.updateApproved = function(sender, recipient, isInitial, campName, link) {
        var data = {
            campName: campName,
            dashboardLink: link
        }, subject, template;

        if (isInitial) {
            subject = 'Reelcontent Campaign Approved';
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
            subject = 'Reelcontent Campaign Rejected';
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
    
    email.campaignEnded = function(sender, recipient, campName, status, dashboardLink, manageLink) {
        var data = {
            campName: campName,
            date: new Date().toLocaleDateString(),
            dashboardLink: dashboardLink,
            manageLink: manageLink
        }, subject, template;
        
        if (status === Status.Expired) {
            subject = 'Your Campaign Has Ended';
            template = 'campaignExpired.html';
        } else {
            subject = 'Your Campaign is Out of Budget';
            template = 'campaignOutOfBudget.html';
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
    email.newUpdateRequest = function(sender, recipient, req, campName, reviewLink) {
        var submitter;

        if (!!req.user) {
            submitter = req.user.company || (req.user.firstName + ' ' + req.user.lastName);
        } else if (req.application) {
            submitter = req.application.key;
        }
        
        var data = {
            requester: (req.user && req.user.email) || (req.application && req.application.key),
            campName: campName,
            reviewLink: reviewLink
        };
        
        return email.compileAndSend(
            sender,
            recipient,
            'New update request from ' + submitter + ' for campaign "' + campName + '"',
            'newUpdateRequest.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };

    // Email with link to activate a newly-created account
    email.activateAccount = function(sender, recipient, activationLink) {
        var data = { activationLink: activationLink };

        return email.compileAndSend(
            sender,
            recipient,
            'Welcome to Reelcontent Video Ads!',
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
            'Reelcontent Password Change Notice',
            'passwordChanged.html',
            data,
            [{ filename: 'logo.png', cid: 'reelContentLogo' }]
        );
    };
    
    /* Notification that user's email has been changed.
     * Includes oldEmail in template if sending to newEmail */
    email.emailChanged = function(sender, recipient, oldEmail, newEmail, contact) {
        var data = {
                newEmail: newEmail,
                contact: contact
            };
        
        if (recipient === newEmail) {
            data.oldEmail = oldEmail;
        }

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
            'Reelcontent: Multiple-Failed Logins',
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
                
            // Converting html to text may result in all-caps links, so switch back to lowercase
            var capsLinks = opts.text.match(/\[HTTPS?:\/\/[^\]]+\]/g);
            (capsLinks || []).forEach(function(link) {
                opts.text = opts.text.replace(link, link.toLowerCase());
            });
                
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
