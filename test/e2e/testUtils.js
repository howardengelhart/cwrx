var request         = require('request'),
    q               = require('q'),
    path            = require('path'),
    fs              = require('fs-extra'),
    aws             = require('aws-sdk'),
    Imap            = require('imap'),
    mailparser      = require('mailparser'),
    events          = require('events'),
    util            = require('util'),
    adtech          = require('adtech'),
    requestUtils    = require('../../lib/requestUtils'),
    mongoUtils      = require('../../lib/mongoUtils'),
    s3util          = require('../../lib/s3util'),
    awsAuth         = process.env['awsAuth'] || path.join(process.env.HOME,'.aws.json'),
    
    testUtils = { _dbCache: {} };


///////////////////////////// Mongo Helper Methods /////////////////////////////

// Close all dbs stored in the cache; should be called in a test spec at the end of each file
testUtils.closeDbs = function() {
    return q.all(Object.keys(testUtils._dbCache).map(function(key) {
        return testUtils._dbCache[key].promise.then(function(db) {
            db.close();
        });
    })).then(function() {
        testUtils._dbCache = {};
    });
};
  
testUtils._getDb = function(userCfg) {
    // console.log('calling getDb');
    userCfg = userCfg || {};
    var procCfg = process.env['mongo'] ? JSON.parse(process.env['mongo']) : {};
    var dbConfig = {
        host : userCfg.host ? userCfg.host : procCfg.host || '33.33.33.100',
        port : userCfg.port ? userCfg.port : procCfg.port || 27017,
        db   : userCfg.db   ? userCfg.db   : procCfg.db || 'c6Db',
        user : userCfg.user ? userCfg.user : procCfg.user || 'e2eTests',
        pass : userCfg.pass ? userCfg.pass : procCfg.pass || 'password'
    };
    var key = dbConfig.host + ':' + dbConfig.port + '/' + dbConfig.db;
    
    if (testUtils._dbCache[key]) {
        return testUtils._dbCache[key].promise;
    } else {
        testUtils._dbCache[key] = q.defer();
        mongoUtils.connect(dbConfig.host,dbConfig.port,dbConfig.db,dbConfig.user,dbConfig.pass).then(function(db) {
            testUtils._dbCache[key].resolve(db);
        });
        return testUtils._dbCache[key].promise;
    }
};

testUtils.mongoFind = function(collection, query, sort, limit, skip, userCfg) {
    var db, coll;
    return testUtils._getDb(userCfg)
        .then(function(database){
            db      = database;
            coll    = db.collection(collection);
            var cursor = coll.find(query, {sort: sort, limit: limit, skip: skip});
            return q.npost(cursor, 'toArray');
        });
};

testUtils.resetCollection = function(collection,data,userCfg){
    var db, coll;
    return testUtils._getDb(userCfg)
        .then(function(database){
            db      = database;
            coll    = db.collection(collection);
            return q.npost(db, 'collectionNames', [collection])
        })
        .then(function(names){
            if (names.length === 0 ) {
                return q();
            }
            return q.npost(coll, 'remove');
        })
        .then(function(){
            if (!data) {
                return q();
            }

            return q.npost(coll,'insert',[data, { w: 1, journal: true }]);
        }).catch(function(error) {
            console.log('\nFailed resetting ' + collection + ' with data ' + JSON.stringify(data, null, 4));
            return q.reject(error);
        }).thenResolve();
};

///////////////////////////// Adtech Helper Methods /////////////////////////////

testUtils._sizeTypeMap = {
    card            : 277,  // 2x2
    miniReel        : 509,  // 2x1
    contentMiniReel : 16    // 1x1
};

// Try to format adtech errors into something that doesn't blow up our console
testUtils.handleAdtechError = function(error) {
    try {
        var err = {
            faultcode: error.root.Envelope.Body.Fault.faultcode,
            faultstring: error.root.Envelope.Body.Fault.faultstring,
            detail: Object.keys(error.root.Envelope.Body.Fault.detail)[0]
        };
        return q.reject('Adtech failure: ' + JSON.stringify(err, null, 4));
    } catch(e) {
        return q.reject(error);
    }
};

// Retrieve active banners for a campaign from Adtech's API. Assumes bannerAdmin was created previously
testUtils.getCampaignBanners = function(campId) {
    var aove = new adtech.AOVE();
    aove.addExpression(new adtech.AOVE.LongExpression('campaignId', parseInt(campId)));
    aove.addExpression(new adtech.AOVE.BooleanExpression('deleted', false));
    return adtech.bannerAdmin.getBannerList(null, null, aove).catch(testUtils.handleAdtechError);
}

// check that banners exist for each id in list, and they have the correct name + sizeTypeId
testUtils.compareBanners = function(banners, list, type) {
    expect(banners.length).toBe(list.length);
    list.forEach(function(id) {
        var banner = banners.filter(function(bann) { return bann.extId === id; })[0];
        expect(banner).toBeDefined('banner for ' + id);
        expect(banner.name).toBe(type + ' ' + id);
        expect(banner.sizeTypeId).toBe(testUtils._sizeTypeMap[type]);
    });
}

///////////////////////////// Miscellaneous Helper Methods /////////////////////////////

testUtils.checkStatus = function(jobId, host, statusUrl, statusTimeout, pollInterval) {
    var interval, timeout,
        pollInterval = pollInterval || 5000,
        deferred = q.defer(),
        options = {
            url: statusUrl + jobId + '?host=' + host 
        };
    
    interval = setInterval(function() {
        requestUtils.qRequest('get', [options])
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


/* Creates an agent that listens for new messages sent to a user from a given sender. The user defaults
 * to c6e2eTester@gmail.com and the sender defaults to support@cinema6.com, these can be overriden through
 * the constructor's optional parameters. Once created, call the (async) start() method. After this,
 * 'message' events are emitted when an email is received from the sender; the data sent with these
 * events is a JSON representation of an email. */
testUtils.Mailman = function(imapOpts, sender) {
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

util.inherits(testUtils.Mailman, events.EventEmitter);

testUtils.Mailman.prototype.start = function() {
    var self = this,
        deferred = q.defer();
        
    if (self.state === 'authenticated') {
        return q('already connected');
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

/* This is used internally when the connection receives a new mail event to fetch the message.
 * However, it can be called manually if needed. If oldEmailOk is not true, this will reject if the
 * message that's fetched has been seen by the checker before (its seqId === self._lastSeqId) */
testUtils.Mailman.prototype.getLatestEmail = function(oldEmailOk) {
    if (this.state !== 'authenticated') {
        return q.reject('You must call this.start() first');
    }
    
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

testUtils.Mailman.prototype.stop = function() {
    this._conn.end();
    this._conn = null;
};


module.exports = testUtils;
