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

    signatures.formatEndpoint = function(method, url) {
        var parsedUrl = urlUtils.parse(url);
        
        return method.toUpperCase() + ' ' + parsedUrl.pathname;
    };

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
    
    signatures.Authenticator.prototype.request = function(method, opts, files, jobPolling) {
        var self = this;
        
        self.setHeaders(method, opts);
        
        return requestUtils.qRequest(method, opts, files, jobPolling);
    };

    
    signatures.Verifier = function(db, tsGracePeriod) {
        var self = this;
        
        self.db = db;
        self.hashAlgorithm = 'SHA256';
        self.tsGracePeriod = tsGracePeriod || 5000;
    };
    
    signatures.Verifier.prototype._fetchApplication = function(key, req) {
        var self = this,
            log = logger.getLog();
        
        return mongoUtils.findObject(
            self.db.collection('applications'),
            { key: key, status: Status.Active }
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
    
    signatures.Verifier.prototype.middlewarify = function(required) {
        var self = this,
            log = logger.getLog(),
            headList = ['x-rc-auth-app-key', 'x-rc-auth-timestamp',
                        'x-rc-auth-nonce', 'x-rc-auth-signature'];
        
        return function authorize(req, res, next) {
            // If missing some/all of required headers, pass if not required, otherwise return 400
            for (var i in headList) {
                if (!req.headers[headList[i]]) {
                    if (!required) {
                        return next();
                    } else {
                        log.info('[%1] App Unauthorized: missing header %2', req.uuid, headList[i]);
                        return res.send(400, 'Must include \'' + headList[i] + '\' header');
                    }
                }
            }
            
            var appKey      = String(req.headers['x-rc-auth-app-key']),
                ts          = parseInt(req.headers['x-rc-auth-timestamp']),
                nonce       = String(req.headers['x-rc-auth-nonce']),
                signature   = String(req.headers['x-rc-auth-signature']);
                
            if ((Date.now() - ts) > self.tsGracePeriod) {
                log.info('[%1] App Unauthorized: timestamp %2 is older than grace period %3',
                         req.uuid, ts, self.tsGracePeriod);
                return res.send(400, 'Request timestamp header is too old');
            }
            
            return self._fetchApplication(appKey, req)
            .then(function(app) {
                if (!app) {
                    return res.send(403, 'Forbidden');
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
                    log.info('[%1] App Unauthorized: computed sig differs from header', req.uuid);
                    return res.send(401, 'Invalid signature');
                }
                
                req.application = mongoUtils.safeApplication(app);
                
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
    
    module.exports = signatures;
}());
