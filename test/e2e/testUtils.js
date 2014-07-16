var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    aws         = require('aws-sdk'),
    Imap        = require('imap'),
    mailparser  = require('mailparser'),
    events      = require('events'),
    util        = require('util'),
    mongoUtils  = require('../../lib/mongoUtils'),
    s3util      = require('../../lib/s3util'),
    awsAuth     = process.env['awsAuth'] || path.join(process.env.HOME,'.aws.json'),
    
    testUtils = {};

testUtils.resetCollection = function(collection,data,userCfg){
    var dbEnv, db, coll, dbConfig;
    if (!userCfg){
        userCfg = process.env['mongo'] ? JSON.parse(process.env['mongo']) : {};
    }
    dbConfig = {
        host : userCfg.host ? userCfg.host : '33.33.33.100',
        // host : userCfg.host ? userCfg.host : 'localhost',
        port : userCfg.port ? userCfg.port : 27017,
        db   : userCfg.db   ? userCfg.db   : 'c6Db',
        user : userCfg.user ? userCfg.user : 'e2eTests',
        pass : userCfg.pass ? userCfg.pass : 'password'
    };
    
    return mongoUtils.connect(dbConfig.host,dbConfig.port,dbConfig.db,dbConfig.user,dbConfig.pass)
        .then(function(database){
            db      = database;
            coll    = db.collection(collection);
            if  (dbConfig.user){
                return q.npost(db, 'authenticate', [ dbConfig.user, dbConfig.pass]);
            }
            return q();
        })
        .then(function(){
            return q.npost(db, 'collectionNames', [collection]);
        })
        .then(function(names){
            if (names.length === 0 ) {
                return q();
            }
            return q.npost(coll, 'drop');
        })
        .then(function(){
            if (!data) {
                return q();
            }

            return q.npost(coll,'insert',[data, { w: 1, journal: true }]);
        })
        .then(function(){
            db.close();
        });
};

// files should be { file1: path, file2: path, ... }. They get appended as multipart/form-data uploads
testUtils.qRequest = function(method, opts, files) {
    var deferred = q.defer();
    opts.method = method;

    var req = request(opts, function(error, response, body) {
        if (error) return deferred.reject(error);
        if (!response) return deferred.reject({error: 'Missing response'});
        body = body || '';
        try {
            body = JSON.parse(body);
        } catch(e) {
        }
        if (body.error) return deferred.reject(body);
        deferred.resolve({response: response, body: body});
    });
    
    if (files && typeof files === 'object' && Object.keys(files).length > 0) {
        var form = req.form();
        Object.keys(files).forEach(function(key) {
            form.append(key, fs.createReadStream(files[key]));
        });
    }
    
    return deferred.promise;
}

testUtils.checkStatus = function(jobId, host, statusUrl, statusTimeout, pollInterval) {
    var interval, timeout,
        pollInterval = pollInterval || 5000,
        deferred = q.defer(),
        options = {
            url: statusUrl + jobId + '?host=' + host 
        };
    
    interval = setInterval(function() {
        qRequest('get', [options])
        .then(function(resp) {
            if (resp.response.statusCode !== 202) {
                clearInterval(interval);
                clearTimeout(timeout);
                deferred.resolve({
                    code: resp.response.statusCode,
                    data: resp.body
                });
            }
        }).catch(function(error) {
            clearInterval(interval);
            clearTimeout(timeout);
            deferred.reject(error);
        });
    }, pollInterval);
    
    timeout = setTimeout(function() {
        clearInterval(interval);
        deferred.reject('Timed out polling status of job');
    }, statusTimeout);
    
    return deferred.promise;
};

testUtils.putS3File = function(params, fpath) {
    aws.config.loadFromPath(awsAuth);
    var s3 = new aws.S3();
    return s3util.putObject(s3, fpath, params);
};

testUtils.removeS3File = function(bucket, key) {
    aws.config.loadFromPath(awsAuth);
    var s3 = new aws.S3(),
        deferred = q.defer(),
        params = { Bucket: bucket, Key: key };

    q.npost(s3, 'deleteObject', [params]).then(function() {
        deferred.resolve();
    }).catch(function(error) {
        deferred.reject('Error deleting ' + bucket + '/' + key + ' : ' + error);
    });
    
    return deferred.promise;
};

// TODO: man this should probably go in a different module but I just don't know...
// TODO maybe include a note about how the password is stored in the clear?
testUtils.EmailChecker = function(imapOpts, sender) { //TODO: creative name?
    var self = this;
    self._imapOpts = imapOpts || { user: 'c6e2eTester@gmail.com', password: 'bananas4bananas',
                                   host: 'imap.gmail.com', port: 993, tls: true };
    self.sender = sender || 'support@cinema6.com';
    self._lastSeqId = -1; // sequence id of the latest message retrieved
    
    Object.defineProperty(self, 'state', {
        get: function() {
            return self._conn && self._conn.state || 'disconnected';
        }
    });
    
    events.EventEmitter.call(this);
};
util.inherits(testUtils.EmailChecker, events.EventEmitter);

testUtils.EmailChecker.prototype.start = function() {
    var self = this,
        deferred = q.defer();
        
    if (self.state === 'authenticated') {
        deferred.resolve('already connected');
    }

    self._conn = new Imap(self._imapOpts); // establish an IMAP connection to the mailbox

    self._conn.on('error', function(error) {
        self.emit('error', error);
        deferred.reject(error);
    });
    
    self._conn.once('ready', function() {
        q.npost(self._conn, 'openBox', ['INBOX', true]).then(function(box) {
            self._conn.on('mail', function(numMessages) {
                self.getLatestEmail().then(function(msgObj) {
                    self.emit('message', msgObj);
                }).catch(function(error) {
                    self.emit('error', error);
                });
            });
            
            deferred.resolve('success');
        })
        .catch(deferred.reject);
    });

    self._conn.connect();
    
    return deferred.promise;
};

// TODO: explain (and probably rename) oldEmailOk
testUtils.EmailChecker.prototype.getLatestEmail = function(oldEmailOk) {
    var parser = new mailparser.MailParser(), // will parse the raw message into a JSON object
        deferred = q.defer(),
        self = this;
        
    parser.on('end', deferred.resolve); // on end event, parser calls with object representing message
    
    q.npost(self._conn.seq, 'search', [[['FROM', self.sender]]])
    .then(function(results) { // results is an array of message sequence numbers
        if (results.length === 0) return q.reject('No messages from ' + self.sender + ' found');

        var seqId = Math.max.apply(null, results); // gets the latest matching message
        
        // If we've already returned this message, reject (unless client ok with old emails)
        if (seqId <= self._lastSeqId && !oldEmailOk) {
            return deferred.reject('Checked for new email but got nothing new from ' + self.sender);
        }
        
        var fetch = self._conn.seq.fetch(seqId, {bodies:''}).on('error', deferred.reject);
        
        fetch.once('message', function(msg, seqno) {
            msg.on('body', function(stream, info) {
                stream.pipe(parser);
            });
            
            msg.on('end', function() {
                self._lastSeqId = seqId;
                parser.end();
            });
        });
    })
    .catch(deferred.reject);

    return deferred.promise;
};

testUtils.EmailChecker.prototype.stop = function() {
    this._conn.end();
    this._conn = null;
};

/**
 * Get a json represenation of the latest email sent to a user from a given sender. The sender
 * defaults to support@cinema6.com and the user defaults to c6e2eTester@gmail.com; these can be
 * overriden through the optional parameters.
 */
testUtils.getLatestEmail = function(imapOpts, sender) {
    var imapOpts = imapOpts || { user: 'c6e2eTester@gmail.com', password: 'bananas4bananas',
                                 host: 'imap.gmail.com', port: 993, tls: true},
        sender = sender || 'support@cinema6.com',
        conn = new Imap(imapOpts), // establish an IMAP connection to the mailbox
        parser = new mailparser.MailParser(), // will parse the raw message into a JSON object
        deferred = q.defer();
    
    parser.on('end', deferred.resolve);
    conn.on('error', deferred.reject);
    
    conn.once('ready', function() {
        q.npost(conn, 'openBox', ['INBOX', true]).then(function(box) {
            return q.npost(conn.seq, 'search', [[['FROM', sender]]]);
        })
        .then(function(results) { // results is an array of message sequence numbers
            if (results.length === 0) return q.reject('No messages from ' + sender + ' found');

            var seqId = Math.max.apply(null, results), // gets the latest matching message
                fetch = conn.seq.fetch(seqId, {bodies:''}).on('error', deferred.reject);
            
            fetch.once('message', function(msg, seqno) {
                msg.on('body', function(stream, info) {
                    stream.pipe(parser);
                });
                
                msg.on('end', function() {
                    parser.end();
                });
            });
        })
        .catch(deferred.reject);
    });
    conn.connect();
    
    return deferred.promise.finally(function() {
        conn.end();
    });
};

module.exports = testUtils;
