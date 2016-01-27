(function(){
    'use strict';
    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        crypto          = require('crypto'),
        uuid            = require('./uuid'),
        logger          = require('./logger'),
        objUtils        = require('./objUtils'),
        authUtils       = require('./authUtils'),
        mongoUtils      = require('./mongoUtils'),
        requestUtils    = require('./requestUtils'),
        Status          = require('./enums').Status,
        appAuthUtils = {};

//TODO: come up with better names for the module + its classes

    appAuthUtils.formatEndpointStr = function(method, url) {
        var parsedUrl = urlUtils.parse(url);
        
        return method.toUpperCase() + ' ' + parsedUrl.pathname;
    };

    appAuthUtils.signData = function(data, hmacAlgorithm, secret) {
        var hmac = crypto.createHmac(hmacAlgorithm, secret),
            toSign;

        if (typeof data === 'string') {
            toSign = data;
        } else {
            toSign = JSON.stringify(objUtils.sortObject(data));
        }
        
        hmac.update(toSign);
        return hmac.digest('hex');
    };


    appAuthUtils.Authenticator = function(creds) {
        var self = this;
        
        if (!creds.key || !creds.secret) {
            throw new Error('Must provide creds object with key + secret');
        }
        
        self._creds = creds;
        self.appKey = creds.key;
        self.hmacAlgorithm = 'RSA-SHA256'; //TODO: configurable?
    };
    
    // Return object with all necessary headers to authenticate request
    appAuthUtils.Authenticator.prototype.setHeaders = function(method, reqOpts) {
        var self = this,
            ts = Date.now(),
            nonce = uuid.createUuid(),
            body = reqOpts.body || (typeof reqOpts.json === 'object' && reqOpts.json) || {},
            bodyHash = uuid.hashText(typeof body === 'string' ? body : JSON.stringify(body));
            
        
        
        /* TODO: may eventually want to add some additional (constant) secret string to the data to
         * sign. Otherwise, if the signature + all signature data is observable from a request, an
         * attacker who observes a request can brute force the secret on their own.
         * 
         * Although, if we use like 40-char hex strings for app secrets, my calculations puts it
         * at something like 9*10^29 years to crack a secret...so... fuck it? */
        var data = {
            appKey      : self.appKey,
            bodyHash    : bodyHash,
            endpoint    : appAuthUtils.getEndpointStr(method, reqOpts.url),
            nonce       : nonce,
            //TODO: qs
            timestamp   : ts
        };
        
        var signature = appAuthUtils.signData(data, self.hmacAlgorithm, self._creds.secret);
        
        reqOpts.headers = reqOpts.headers || {};

        objUtils.extend(reqOpts.headers, {
            'x-rc-auth-app-key': self.appKey,
            'x-rc-auth-timestamp': ts,
            'x-rc-auth-nonce': nonce,
            'x-rc-auth-signature': signature
        });
    };
    
    appAuthUtils.Authenticator.prototype.request = function(method, opts, files, jobPolling) {
        var self = this;
        
        self.setHeaders(method, opts);
        
        return requestUtils.qRequest(method, opts, files, jobPolling);
    };

    
    appAuthUtils.Verifier = function(db, tsGracePeriod) {
        var self = this;
        
        self.db = db;
        self.hmacAlgorithm = 'RSA-SHA256'; //TODO: configurable?
        self.tsGracePeriod = tsGracePeriod || 5000;
    };
    
    appAuthUtils.Verifier.prototype._fetchApplication = function(key, req) {
        var self = this,
            log = logger.getLog();
        
        return mongoUtils.findObject(
            self.db.collection('applications'),
            { key: key, status: Status.Active } //TODO: reconsider status?
        )
        .then(function(app) {
            if (!app) {
                log.info('[%1] App %2 not found or not active', req.uuid, key);
            }
            return app;
        })
        .catch(function(error) {
            log.error('[%1] Error fetching application %2: %3', req.uuid, key, util.inspect(error));
            return q.reject('Db error');
        });
    };
    
    appAuthUtils.Verifier.prototype.middlewarify = function(optional, perms) {
        var self = this,
            log = logger.getLog(),
            headerList = ['x-rc-auth-app-key', 'x-rc-auth-timestamp',
                          'x-rc-auth-nonce', 'x-rc-auth-signature'];
        
        return function authorize(req, res, next) {
            // If missing some/all of required headers, pass if optional, otherwise return 400
            for (var i in headerList) {
                if (!req.headers[headerList[i]]) {
                    if (optional) {
                        return next();
                    } else {
                        log.info('[%1] Unauthorized: missing header %2', req.uuid, headerList[i]);
                        return res.send(400, 'Must include \'' + headerList[i] + '\' header');
                    }
                }
            }
            
            var appKey      = req.headers['x-rc-auth-app-key'],
                ts          = req.headers['x-rc-auth-timestamp'],
                nonce       = req.headers['x-rc-auth-nonce'],
                signature   = req.headers['x-rc-auth-signature'];
                
            if ((Date.now() - ts) > self.tsGracePeriod) {
                log.info('[%1] Unauthorized: timestamp %2 is older than grace period %3',
                         req.uuid, ts, self.tsGracePeriod);
                return res.send(400, 'Request timestamp header is too old');
            }
            
            return self._fetchApplication(appKey, req)
            .then(function(app) {
                if (!app) {
                    return res.send(403, 'Forbidden');
                }
                
                var bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
                    bodyHash = uuid.hashText(bodyStr);
                
                var signData = {
                    appKey      : appKey,
                    bodyHash    : bodyHash,
                    endpoint    : appAuthUtils.getEndpointStr(req.method, req.originalUrl),
                    nonce       : nonce,
                    qs          : urlUtils.parse(req.originalUrl).query,
                    timestamp   : ts
                };
                
                var computedSig = appAuthUtils.signData(signData, self.hmacAlgorithm, app.secret);
                
                if (signature !== computedSig) {
                    log.info('[%1] Unauthorized: computed signature differs from header', req.uuid);
                    return res.send(401, 'Invalid signature'); //TODO: 401 or 400?
                }
                
                req.application = mongoUtils.safeApplication(app);
                
                if (!authUtils._compare(perms, req.application.permissions || {})) {
                    log.info('[%1] Unauthorized: permissions do not match', req.uuid);
                    return res.send(403, 'Forbidden');
                }
                
                log.trace('[%1] Successfully authenticated app %2', req.uuid, appKey);
                
                return next();
            })
            .catch(function(error) {
                var msg = 'Error checking authorization of app';
                log.error('[%1] %2: %3', req.uuid, msg, util.inspect(error));
                return res.send(500, msg);
            });
        };
    };
    
    module.exports = appAuthUtils;
}());
