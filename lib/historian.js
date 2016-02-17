(function(){
    'use strict';
    var objUtils    = require('./objUtils'),
        Status      = require('./enums').Status,
        
        historian = {};

    //TODO: comment, tests        
    
    historian.historify = function(field, historyField, body, origObj, req) {
        origObj = origObj || {};
        var status = body.status || origObj.status;
        
        if (!field || !historyField) {
            throw new Error('Must provide field name + history field name');
        }

        if (body[field] && !objUtils.compareObjects(body[field], origObj[field])) {
            body[historyField] = origObj[historyField] || [];
            
            var wrapper = {
                date: new Date()
            };
            
            wrapper[field] = body[field];
            
            if (req.user) {
                wrapper.userId = req.user.id;
                wrapper.user = req.user.email;
            } else {
                wrapper.appId = req.application.id;
                wrapper.appKey = req.application.key;
            }
            
            if (field !== 'status' && status === Status.Draft) {
                body[historyField][0] = wrapper;
            } else {
                body[historyField].unshift(wrapper);
            }
        }
    };
    
    historian.middlewarify = function(field, historyField) {
        return function(req, next/*, done*/) {
            historian.historify(field, historyField, req.body, req.origObj, req);
            return next();
        };
    };

    module.exports = historian;
}());
