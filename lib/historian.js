(function(){
    'use strict';
    var objUtils    = require('./objUtils'),
        Status      = require('./enums').Status,
        
        historian = {};

    /**
     * Track changes to <field> in <historyField>. If body[field] differs from origObj[field],
     * update body[field] with <historyField>, adding an entry for the new <field> value.
     */
    historian.historify = function(field, historyField, body, origObj, req) {
        origObj = origObj || {};
        var status = body.status || origObj.status;
        
        if (!field || !historyField) {
            throw new Error('Must provide field name + history field name');
        }
        
        delete body[historyField];

        if (body[field] && !objUtils.compareObjects(body[field], origObj[field])) {
            // overwrites any changes user may have made to historyField
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
            
            // Do not track history for objects in Draft state, just update latest history entry
            if (field !== 'status' && status === Status.Draft) {
                body[historyField][0] = wrapper;
            } else {
                body[historyField].unshift(wrapper);
            }
        }
    };
    
    // Return CrudSvc middleware that calls historify, comparing req.body and req.origObj
    historian.middlewarify = function(field, historyField) {
        return function(req, next/*, done*/) {
            historian.historify(field, historyField, req.body, req.origObj, req);
            return next();
        };
    };

    module.exports = historian;
}());
