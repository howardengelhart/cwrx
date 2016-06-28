var request         = require('request'),
    q               = require('q'),
    path            = require('path'),
    fs              = require('fs-extra'),
    aws             = require('aws-sdk'),
    Imap            = require('imap'),
    mailparser      = require('mailparser'),
    pg              = require('pg.js'),
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
    
//////////////////////////// Postgres Helper Methods ///////////////////////////

// Similar to pgUtils.query, but constructs connection config internally (or through userCfg)
testUtils.pgQuery = function(statement, params, userCfg) {
    var deferred = q.defer();
    userCfg = userCfg || {};
        
    var conn = {
        user        : userCfg.user || 'cwrx',
        password    : userCfg.password || 'password',
        database    : userCfg.database || 'campfire_cwrx',
        host        : userCfg.host || (process.env.mongo ? JSON.parse(process.env.mongo).host : '33.33.33.100')
    };

    pg.connect(conn, function(err, client, done){
        if (err) {
            return deferred.reject(err);
        }

        client.query(statement, params, function(err,res) {
            if (err) {
                done();
                return deferred.reject(err);
            }

            done();
            return deferred.resolve(res);
        });

    });

    return deferred.promise;
};

/* Truncate the given table, and then insert the data, if defined. data should be an array of
 * strings representing the rows to insert. Alternatively, an array of field names can be passed as
 * the fields arg, and the strings in the data array need only contain those fields */
testUtils.resetPGTable = function(tableName, data, userCfg, fields) {
    return testUtils.pgQuery('TRUNCATE TABLE ' + tableName, null, userCfg)
    .then(function() {
        if (!data || !(data instanceof Array)) {
            return q();
        }
        var statement = 'INSERT INTO ' + tableName;

        if (fields && fields.length > 0) {
            statement += '(' + fields.join(',') + ')';
        }
        
        statement += ' VALUES ' + data.join(', ') + ';';
        
        return testUtils.pgQuery(statement, null, userCfg);
    })
    .thenResolve();
};

/* Return a string of values representing a record that can be inserted into the data of resetPGTable.
 * fields should be an in-order array of column names, and obj should be a hash containing values for each field. */
testUtils.stringifyRecord = function(obj, fields) {
    var str = '(';
    fields.forEach(function(field) {
        var val = (obj[field] !== undefined) ? obj[field] : null;
        if (typeof val === 'string') {
            str += '\'' + val + '\',';
        } else {
            str += val + ',';
        }
    });
    str = str.replace(/,$/, '') + ')';
    return str;
}


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
        })
        .catch(testUtils._dbCache[key].reject);

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

testUtils.resetCollection = function(collection, data, userCfg) {
    var db, coll;
    
    return testUtils._getDb(userCfg).then(function(database) {
        db      = database;
        coll    = db.collection(collection);
        return q(coll.deleteMany(
            { _preserve: { $ne: true } }, // do not delete certain important items, like internal apps
            { w: 1 , journal: true }
        ));
    })
    .then(function() {
        if (!data) {
            data = [];
        }
        if (!Array.isArray(data)) {
            data = [data];
        }
        if (data.length === 0) {
            return q();
        }

        return q(coll.insertMany(data, { w: 1, journal: true }));
    })
    .catch(function(error) {
        console.log('\nFailed resetting ' + collection + ' with data ' + JSON.stringify(data, null, 4));
        console.log(error);
        return q.reject(error);
    })
    .thenResolve();
};

////////////////////////////////// AWS Helper Methods //////////////////////////////////

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

/**
 * "Mock" version of watchman: takes a stream name from opts or process.env and "listens" for new
 * records (by polling every 3 seconds). Will emit a 'data' event with the record parsed as JSON
 * whenever it gets a new record.
 */
testUtils.Mockman = function(opts) {
    var self = this;
    opts = opts || {};

    aws.config.loadFromPath(awsAuth);
    
    self.kinesis = new aws.Kinesis({ region: 'us-east-1' });
    self.streamName = opts.streamName || process.env.streamName || 'devCwrxStream-' + process.env.USER;
    self.shardId = opts.shardId || 'shardId-000000000000';
    self.shardIterator = null;
    self.pollInterval = opts.pollInterval || 3000;

    events.EventEmitter.call(this);
};
util.inherits(testUtils.Mockman, events.EventEmitter);

testUtils.Mockman.prototype.start = function() {
    var self = this;
    
    if (!!self.shardIterator) {
        return q('already started');
    }
    
    return q.npost(self.kinesis, 'getShardIterator', [{
        ShardId: self.shardId,
        ShardIteratorType: 'LATEST',
        StreamName: self.streamName
    }])
    .then(function(resp) {
        self.shardIterator = resp.ShardIterator;
        
        self._interval = setInterval(function() {
            q.npost(self.kinesis, 'getRecords', [{ ShardIterator: self.shardIterator }])
            .then(function(resp) {
                if (!!resp.NextShardIterator) {
                    self.shardIterator = resp.NextShardIterator;
                }
                
                if (!!resp.Records && resp.Records.length > 0) {
                    resp.Records.forEach(function(record) {
                        var dataStr, jsonData;
                        if (typeof record.Data === 'string') {
                            dataStr = new Buffer(record.Data, 'base64').toString();
                        } else {
                            dataStr = record.Data.toString();
                        }
                    
                        try {
                            jsonData = JSON.parse(dataStr);
                        } catch(e) {
                            console.log(util.format('Mockman: error parsing data for record %s: %s, data = %s', record.SequenceNumber, util.inspect(e), dataStr));
                            return;
                        }
                        
                        self.emit('data', jsonData);
                        if(jsonData.type) {
                            self.emit(jsonData.type, jsonData);
                        }
                    });
                }
            })
            .catch(function(error) {
                console.log(util.format('Mockman: error calling getRecords on %s: %s', self.streamName, util.inspect(error)));
            });
        }, self.pollInterval);
    })
};

testUtils.Mockman.prototype.stop = function() {
    var self = this;
    
    clearInterval(self._interval);
    delete self._interval;
    delete self.shardIterator;
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
