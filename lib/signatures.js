(function(){
    'use strict';
    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        crypto          = require('crypto'),
        querystring     = require('querystring'),
        requestUtils    = require('./requestUtils'),
        Status          = require('./enums').Status,
        mongoUtils      = require('./mongoUtils'),
        objUtils        = require('./objUtils'),
        logger          = require('./logger'),
        uuid            = require('./uuid'),
        signatures = {};
        
    // Format a request method + url into an "endpoint string", e.g. 'GET /api/campaign/cam-1'
    signatures.formatEndpoint = function(method, url) {
        var parsedUrl = urlUtils.parse(url);
        
        return method.toUpperCase() + ' ' + parsedUrl.pathname;
    };

    // Compute + return a hash of data, using the provided hashAlgorithm + secret
    signatures.signData = function(data, hashAlgorithm, secret) {
        var hmac = crypto.createHmac(hashAlgorithm, secret),
            toSign;

        if (typeof data === 'string') {
            toSign = data;
        } else {
            toSign = JSON.stringify(objUtils.sortObject(data));
        }
        
        hmac.update(toSign);
        return hmac.digest('hex');
    };

    /**
     * Proxy a request to one of our API services, preserving the current auth status (forwards
     * cookie header if a user is logged in, sets app auth headers if an app is authenticated).
     */
    signatures.proxyRequest = function(req, method, opts, files, jobPolling) {
        opts.headers = opts.headers || {};
        opts.headers.cookie = req.headers.cookie || undefined;
        
        if (!req.application || !req.application.key || !req._appSecret) {
            return requestUtils.qRequest(method, opts, files, jobPolling);
        }
        
        var authenticator = new signatures.Authenticator({
            key: req.application.key,
            secret: req._appSecret
        });
        
        return authenticator.request(method, opts, files, jobPolling);
    };


    /**
     * A class for constructing + sending signed requests. creds should be an object with an
     * application `key` and `secret`.
     */
    signatures.Authenticator = function(creds) {
        var self = this;
        
        if (!creds || !creds.key || !creds.secret) {
            throw new Error('Must provide creds object with key + secret');
        }
        
        self._creds = creds;
        self.appKey = creds.key;
        self.hashAlgorithm = 'SHA256';
    };
    
    // Return object with all necessary headers to authenticate request
    signatures.Authenticator.prototype.setHeaders = function(method, reqOpts) {
        var self = this,
            log = logger.getLog(),
            ts = Date.now(),
            nonce = uuid.createUuid();
        
        var body = reqOpts.body || (typeof reqOpts.json === 'object' && reqOpts.json) || {},
            bodyHash = uuid.hashText(
                typeof body === 'string' ? body : JSON.stringify(body),
                self.hashAlgorithm
            );
            
        var qs = reqOpts.qs ? querystring.stringify(reqOpts.qs) : urlUtils.parse(reqOpts.url).query;
            
        var data = {
            appKey      : self.appKey,
            bodyHash    : bodyHash,
            endpoint    : signatures.formatEndpoint(method, reqOpts.url),
            nonce       : nonce,
            qs          : qs,
            timestamp   : ts
        };
        
        log.trace('Authenticator signing data: %1', JSON.stringify(data, null, 2));
        
        var signature = signatures.signData(data, self.hashAlgorithm, self._creds.secret);
        
        reqOpts.headers = reqOpts.headers || {};
        reqOpts.headers['x-rc-auth-app-key'] = self.appKey;
        reqOpts.headers['x-rc-auth-timestamp'] = ts;
        reqOpts.headers['x-rc-auth-nonce'] = nonce;
        reqOpts.headers['x-rc-auth-signature'] = signature;
    };
    
    // Send a signed request, calling setHeaders on opts first and then requestUtils.qRequest
    signatures.Authenticator.prototype.request = function(method, opts, files, jobPolling) {
        var self = this;
        
        self.setHeaders(method, opts);
        
        return requestUtils.qRequest(method, opts, files, jobPolling);
    };


    /**
     * A class for verifying signed requests. db should be a mongo db (c6Db), tsGracePeriod is the
     * max time in milliseconds the verifier will trust a 'x-rc-auth-timestamp' header.
     */
    signatures.Verifier = function(db, tsGracePeriod) {
        var self = this;
        
        self.db = db;
        self.hashAlgorithm = 'SHA256';
        self.tsGracePeriod = tsGracePeriod || 5000;
    };
    
    // Fetch the requesting application by key from mongo.
    signatures.Verifier.prototype._fetchApplication = function(key, req) {
        var self = this,
            log = logger.getLog();
        
        return mongoUtils.findObject(
            self.db.collection('applications'),
            { key: key, status: Status.Active }
        )
        .catch(function(error) {
            log.error('[%1] Error fetching application %2: %3', req.uuid, key, util.inspect(error));
            return q.reject('Db error');
        });
    };
    
    /**
     * Verify whether the request has been properly signed by a valid app. Returned object format:
     * {
     *     success      : Boolean,  // whether or not the app has authenticated successfully
     *     application  : Object    // authenticated app, if success === true
     *     code         : Number,   // if set, response should be returned with this status code
     *     message      : String,   // if set, response will be returned with this body message
     * }
     */
    signatures.Verifier.prototype.verifyReq = function(req) {
        var self = this,
            log = logger.getLog();

        var appKey      = String(req.headers['x-rc-auth-app-key'] || ''),
            ts          = parseInt(req.headers['x-rc-auth-timestamp'] || ''),
            nonce       = String(req.headers['x-rc-auth-nonce'] || ''),
            signature   = String(req.headers['x-rc-auth-signature'] || '');
        
        if (!appKey || !ts || !nonce || !signature) {
            return q({ success: false });
        }
        
        if ((Date.now() - ts) > self.tsGracePeriod) {
            log.info('[%1] Unauthorized: timestamp %2 is older than grace period %3',
                     req.uuid, ts, self.tsGracePeriod);
            return q({ success: false, code: 400, message: 'Request timestamp header is too old' });
        }
        
        return self._fetchApplication(appKey, req)
        .then(function(app) {
            if (!app) {
                log.info('[%1] Unauthorized: app %2 not found', req.uuid, appKey);
                return q({ success: false, code: 401, message: 'Unauthorized' });
            }
            
            var bodyHash = uuid.hashText(
                typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}),
                self.hashAlgorithm
            );
            
            var signData = {
                appKey      : appKey,
                bodyHash    : bodyHash,
                endpoint    : signatures.formatEndpoint(req.method, req.originalUrl),
                nonce       : nonce,
                qs          : urlUtils.parse(req.originalUrl).query,
                timestamp   : ts
            };

            log.trace('Verifier signing data: %1', JSON.stringify(signData, null, 2));
            
            var computedSig = signatures.signData(signData, self.hashAlgorithm, app.secret);
            
            if (signature !== computedSig) {
                log.info('[%1] Unauthorized: computed sig differs from header', req.uuid);
                return q({ success: false, code: 401, message: 'Unauthorized' });
            }
            
            log.trace('[%1] Successfully authenticated app %2', req.uuid, appKey);
            
            // need to save this in case we need to proxy new requests for this app
            req._appSecret = app.secret;

            return q({ success: true, application: mongoUtils.safeApplication(app) });
        });
    };
    
    module.exports = signatures;
}());
