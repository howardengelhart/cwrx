var flush = true;
describe('sponsor-customers (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, mockClient;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        custModule      = require('../../bin/sponsor-customers');
        CrudSvc         = require('../../lib/crudSvc');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        mockClient = {client: 'yes'};
        delete require.cache[require.resolve('adtech/lib/customer')];
        adtech = require('adtech');
        adtech.customerAdmin = require('adtech/lib/customer');
        Object.keys(adtech.customerAdmin).forEach(function(prop) {
            if (typeof adtech.customerAdmin[prop] !== 'function') {
                return;
            }
            adtech.customerAdmin[prop] = adtech.customerAdmin[prop].bind(adtech.customerAdmin, mockClient);
            spyOn(adtech.customerAdmin, prop).andCallThrough();
        });
    });

    //TODO
    describe('setupSvc', function() {
        
    });
});
