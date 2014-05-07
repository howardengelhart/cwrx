(function(){
    'use strict';

    var q               = require('q'),
        path            = require('path'),
        emailTemplates  = require('email-templates'),
        email = {};
                
    email.sendTemplate = function(ses, addrParams, subject, template, data) {
        return q.nfapply(emailTemplates, [path.join(__dirname, '../templates/')])
        .then(function(makeTemplate) {
            return q.nfapply(makeTemplate, [template, data]);
        }).spread(function(html, text) {
            var bodyParams = { text: text, html: html };
            return email.send(addrParams, subject, bodyParams, ses)
            .then(function(data) {
                return q(data);
            }).catch(function(error) {
                return q.reject(error);
            });
        });
    };
    
    /**
     * addrParams should be { sender: 'foo@bar.com', recipient: 'baz@bar.com' }.
     * subect should be a string.
     * bodyParams should contain a string of text and/or a string of html
     * ses should be a properly initialized aws.SES object
     */
    email.send = function(ses, addrParams, subject, bodyParams) {
        if (!addrParams || !subject || !bodyParams || !ses) {
            return q.reject('Must include addrParams, subject, bodyParams, and ses');
        }
        
        var params = { Destination: {}, Message: { Body: {} }};
        params.Source = addrParams.sender;
        params.ReturnPath = addrParams.sender;
        params.Destination.ToAddresses = [ addrParams.recipient ];
        params.Message.Subject = { Data: subject };
        if (bodyParams.text) {
            params.Message.Body.Text = { Data: bodyParams.text };
        }
        if (bodyParams.html) {
            params.Message.Body.Html = { Data: bodyParams.html };
        }
        
        return q.npost(ses, 'sendEmail', [params])
        .then(function(data) {
            return q(data);
        }).catch(function(error) {
            return q.reject(error);
        });
    };

    module.exports = email;
}());
