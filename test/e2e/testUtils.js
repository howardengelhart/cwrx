var request         = require('request'),
    q               = require('q'),
    path            = require('path'),
    fs              = require('fs-extra'),
    aws             = require('aws-sdk'),
    Imap            = require('imap'),
    mailparser      = require('mailparser'),
    events          = require('events'),
    util            = require('util'),
    requestUtils    = require('../../lib/requestUtils'),
    mongoUtils      = require('../../lib/mongoUtils'),
    objUtils        = require('../../lib/objUtils'),
    s3util          = require('../../lib/s3util'),
    awsAuth         = process.env.awsAuth || path.join(process.env.HOME,'.aws.json'),
    
    testUtils = {
        _dbCache    : {}
    };


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
    var procCfg = process.env.mongo ? JSON.parse(process.env.mongo) : {};
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

testUtils.mongoFind = function(collName, query, sort, limit, skip, userCfg) {
    var db, coll;
    return testUtils._getDb(userCfg)
        .then(function(database){
            db      = database;
            coll    = db.collection(collName);
            return q(coll.find(query, {sort: sort, limit: limit, skip: skip}).toArray());
        });
};

testUtils.mongoUpsert = function(collName, query, obj, userCfg) {
    var coll;
    
    return testUtils._getDb(userCfg).then(function(database) {
        coll = database.collection(collName);
        
        return q(coll.findOneAndUpdate(
            query,
            obj,
            { w: 1, journal: true, returnOriginal: false, upsert: true, sort: { id: 1 } }
        ));
    });
};

testUtils.resetCollection = function(collection,data,userCfg){
    var db, coll, sixxyUser;
    
    return q()
        .then(function() {
            if(collection === 'users') {
                return testUtils.mongoFind(collection, {id: 'u-sixxy'})
                    .then(function(results) {
                        if(results.length === 0) {
                            console.log('There is no sixxy user. Some e2e tests will fail. Create it by running the included sixxyUser.js script.');
                        } else {
                            sixxyUser = results[0];
                        }
                    });
            }
        })
        .then(function() {
            return testUtils._getDb(userCfg);
        })
        .then(function(database){
            db      = database;
            coll    = db.collection(collection);
            return q(coll.deleteMany({}, { w: 1 , journal: true }));
        })
        .then(function(){
            if (!data) {
                data = [];
            }
            if(!Array.isArray(data)) {
                data = [data];
            }
            if(sixxyUser) {
                data.push(sixxyUser);
            }
            if(data.length === 0) {
                return q();
            }

            return q(coll.insertMany(data, { w: 1, journal: true }));
        }).catch(function(error) {
            console.log('\nFailed resetting ' + collection + ' with data ' + JSON.stringify(data, null, 4));
            console.log(error);
            return q.reject(error);
        }).thenResolve();
};

///////////////////////////// Miscellaneous Helper Methods /////////////////////////////

// For each entry in camp.cards, check that it matches the card entity (fetched through content svc)
testUtils.checkCardEntities = function(camp, jar, contentUrl) {
    return q.all(camp.cards.map(function(card) {
        return requestUtils.qRequest('get', {
            url: contentUrl + '/cards/' + card.id,
            jar: jar,
        }).then(function(resp) {
            expect(resp.response.statusCode).toBe(200);
            expect(resp.body).toEqual(card);
        });
    })).catch(function(error) {
        expect(util.inspect(error)).not.toBeDefined();
    });
};

testUtils.checkStatus = function(jobId, host, statusUrl, statusTimeout, pollInterval) {
    var interval, timeout,
        deferred = q.defer(),
        options = {
            url: statusUrl + jobId + '?host=' + host 
        };
    
    pollInterval = pollInterval || 5000;
    
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


/* Creates an agent that listens for emails for a given account (defaults to c6e2eTester@gmail.com).
 * Once created, call the (async) start() method. This should be done once at the beginning of your tests.
 * After this, every time the inbox receives an email, an events will be emitted with the email's subject;
 * these events will include a JSON representation of the email as the data.
 * 
 * To ensure that your test code receives the right email for the right request, you should attach a listener
 * for the expected subject in each test that you expect to result in an email, and wait to call done()
 * until the listener receives the event. */
testUtils.Mailman = function(imapOpts) {
    var self = this;
    self._imapOpts = imapOpts || {};
    objUtils.extend(self._imapOpts, {
        user: 'c6e2eTester@gmail.com',
        password: 'bananas4bananas',
        host: 'imap.gmail.com',
        port: 993,
        tls: true
    });
    self._lastSeqId = -1; // sequence id of the latest message retrieved
    
    self._fetchJob = null; // queue fetch jobs to handle possible concurrency issues
    
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
        console.error(util.inspect(error));
        deferred.reject(error);
    });
    
    self._conn.once('ready', function() {
        q.npost(self._conn, 'openBox', ['INBOX', true]).then(function(box) {
            self._lastSeqId = box.messages.total;

            self._conn.on('mail', function() {
                self.getLatestEmails().then(function(messages) {
                    messages.forEach(function(msg) {
                        self.emit(msg.subject, msg);
                    });
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

/* This is used internally when the connection receives a new 'mail' event to fetch new messages.
 * However, it can be called manually if needed. This will fetch any emails after the internal lastSeqId,
 * and return a JSON representation of the messages found. It will also update lastSeqId appropriately. */
testUtils.Mailman.prototype.getLatestEmails = function() {
    if (this.state !== 'authenticated') {
        return q.reject('You must call this.start() first');
    }
    
    var self = this,
        msgPromises = [],
        deferred = q.defer();        
    
    var fetch = self._conn.seq.fetch((self._lastSeqId + 1) + ':*', { bodies: '' });
    
    fetch.on('error', deferred.reject);
    
    fetch.on('message', function(msg, seqId) {
        var msgDeferred = q.defer(),
            parser = new mailparser.MailParser();
            
        parser.on('end', msgDeferred.resolve);
            
        msgPromises.push(msgDeferred.promise);
        
        msg.on('body', function(stream, info) {
            stream.pipe(parser);
        })
        .on('end', function() {
            self._lastSeqId = Math.max(self._lastSeqId, seqId);
            parser.end();
        })
        .on('error', deferred.reject);
    });
    
    fetch.on('end', function() {
        q.all(msgPromises)
        .then(function(messages) {
            deferred.resolve(messages);
        })
        .catch(deferred.reject);
    });
    
    return deferred.promise;
};

testUtils.Mailman.prototype.stop = function() {
    this._conn.end();
    this._conn = null;
};


module.exports = testUtils;
