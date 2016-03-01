(function(){
    'use strict';
    var urlUtils        = require('url'),
        uuid            = require('rc-uuid'),
        crypto          = require('crypto'),
        querystring     = require('querystring'),
        objUtils        = require('./objUtils'),
        hashUtils       = require('./hashUtils'),

        signatures = { hashAlgorithm: 'SHA256' };
        
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
    
    // Use app creds to attaching necessary authentication headers to reqOpts
    signatures.setAuthHeaders = function(creds, method, reqOpts) {
        if (!creds || !creds.key || !creds.secret) {
            throw new Error('Must provide creds object with key + secret');
        }
        
        var ts = Date.now(),
            nonce = uuid.randomUuid(40);

        var body = reqOpts.body || (typeof reqOpts.json === 'object' && reqOpts.json) || {},
            bodyHash = hashUtils.hashText(
                typeof body === 'string' ? body : JSON.stringify(body),
                signatures.hashAlgorithm
            );
        
        var qs;
        if (reqOpts.qs) {
            if (Object.keys(reqOpts.qs).length === 0) {
                qs = null;
            } else {
                qs = querystring.stringify(reqOpts.qs);
            }
        } else {
            qs = urlUtils.parse(reqOpts.url).query;
        }
            
        var data = {
            appKey      : creds.key,
            bodyHash    : bodyHash,
            endpoint    : signatures.formatEndpoint(method, reqOpts.url),
            nonce       : nonce,
            qs          : qs,
            timestamp   : ts
        };
        
        var signature = signatures.signData(data, signatures.hashAlgorithm, creds.secret);
        
        reqOpts.headers = reqOpts.headers || {};
        reqOpts.headers['x-rc-auth-app-key'] = creds.key;
        reqOpts.headers['x-rc-auth-timestamp'] = ts;
        reqOpts.headers['x-rc-auth-nonce'] = nonce;
        reqOpts.headers['x-rc-auth-signature'] = signature;
    };
    

    // Parse values from auth headers into appropriate types
    signatures.parseAuthHeaders = function(req) {
        return {
            appKey      : String(req.headers['x-rc-auth-app-key'] || ''),
            ts          : parseInt(req.headers['x-rc-auth-timestamp'] || ''),
            nonce       : String(req.headers['x-rc-auth-nonce'] || ''),
            signature   : String(req.headers['x-rc-auth-signature'] || '')
        };
    };

    // Check if the request has been signed correctly, given the app (must have key + secret props).
    signatures.verifyRequest = function(req, app) {
        var params = signatures.parseAuthHeaders(req);

        if (!params.appKey || !params.ts || !params.nonce || !params.signature) {
            return false;
        }

        var bodyHash = hashUtils.hashText(
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}),
            signatures.hashAlgorithm
        );
        
        var signData = {
            appKey      : params.appKey,
            bodyHash    : bodyHash,
            endpoint    : signatures.formatEndpoint(req.method, req.originalUrl),
            nonce       : params.nonce,
            qs          : urlUtils.parse(req.originalUrl).query,
            timestamp   : params.ts
        };

        var computedSig = signatures.signData(signData, signatures.hashAlgorithm, app.secret);
        
        return params.signature === computedSig;
    };
    
    module.exports = signatures;
}());
