/* jshint bitwise: false */
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var q           = require('q'),
        crypto      = require('crypto'),
        fs          = require('fs-extra'),
        hostUtils   = require('./hostUtils'),
        uuid = {};

    // Return a random integer between 0 and max
    uuid.randInt = function(max) {
        return Math.floor(Math.random() * (max || 0));
    };
    
    // Return a hex digest of a hash of the string txt. Hashes with sha1 or second param.
    uuid.hashText = function(txt, alg){
        alg = alg || 'sha1';
        var hash = crypto.createHash(alg);
        hash.update(txt);
        return hash.digest('hex');
    };
    
    // Return a hex digest of a hash of the file at the given path. Hashes with sha1 or second param
    uuid.hashFile = function(fpath, alg) {
        alg = alg || 'md5';
        var stream = fs.createReadStream(fpath),
            hash = crypto.createHash(alg),
            deferred = q.defer();

        stream.on('data', function(data) {
            hash.update(data);
        });
        stream.on('end', function() {
            deferred.resolve(hash.digest('hex'));
        });
        stream.on('error', function(error) {
            deferred.reject(error);
        });
        
        return deferred.promise;
    };
    
    //TODO: are we sure we shouldn't open source this?
    
    // NOTE: DO NOT CHANGE THESE
    var OLD_TS      = 1456180341591,
        ALPHABET    = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ~!';

    /**
     * UUIDs are generated using this private singleton generator object.
     * They are 16 characters chosen from the alphabet above, and should be guaranteed unique.
     * The uuids are generated from 4 components: a machineId, processId, timestamp, and counter,
     * each of which is an integer that is then encoded into a string using the above chars.
     * NOTE: UUIDs should not be truncated or modified if you want to maintain uniqueness
     */
    var generator = {
        components: {
            machineId: {
                length: 3
            },
            processId: {
                length: 3
            },
            ts: {
                length: 7
            },
            counter: {
                length: 3
            }
        },
        previousTS: 0,
        counter: 0
    };
    
    // start counter at random int b/t 0 and max value possible for 3-char string
    generator.components.counter.max = Math.pow(ALPHABET.length,
                                                generator.components.counter.length);
    generator.components.counter.start = uuid.randInt(generator.components.counter.max);
    generator.counter = generator.components.counter.start;

    // If val is too large for its type (based on generator components' length), modulo it
    generator.capValue = function(val, type) {
        return val % Math.pow(ALPHABET.length, this.components[type].length);
    };
    
    // Get a "machine id": computed by treating last two sections of local IP address as 2-byte int
    generator.getMachineId = function() {
        var ip = hostUtils.getIp(),
            ipMatch = ip.match(/(\d+)\.(\d+)$/),
            ipNums = [ parseInt(ipMatch[1]), parseInt(ipMatch[2]) ];
        
        return (ipNums[0] << 8) + ipNums[1];
    };
    
    // Convert val into a string appropriate for the given type
    generator.encode = function(val, type) {
        var self = this,
            desiredLength = type ? self.components[type].length : 0,
            maxCharVal = ALPHABET.length - 1,
            str = '';
        
        while (val >= 1) {
            var charCode = val & maxCharVal;
            str = ALPHABET.charAt(charCode) + str;
            val = val / ALPHABET.length;
        }
        
        // If string shorter than max length for given type, pad with '0'
        while (str.length < desiredLength) {
            str = '0' + str;
        }
        
        return str;
    };
    
    // Decode a previously encoded string into an integer, used for parsing uuids
    generator.decode = function(str) {
        var val = 0;
            
        for (var i = 0; i < str.length; i++) {
            var charVal = ALPHABET.indexOf(str.charAt(i));
            val += ( charVal * Math.pow(ALPHABET.length, (str.length - i - 1)) );
        }
        
        return val;
    };
    
    // Create and return a new uuid
    generator.generate = function() {
        var self = this;

        var machineId = self.capValue(generator.getMachineId(), 'machineId'),
            processId = self.capValue(process.pid, 'processId');
            
        // Express ts as difference from a reference time, to allow ts 
        var ts = self.capValue(Date.now() - OLD_TS, 'ts');
        
        // If ts unchanged since last generation, increment counter; otherwise, reset counter
        if (ts === self.previousTS) {
            self.counter++;
        } else {
            self.counter = self.components.counter.start;
        }
        
        self.previousTS = ts;
        
        var counter = self.capValue(self.counter, 'counter');
        
        return self.encode(machineId, 'machineId') +
               self.encode(processId, 'processId') +
               self.encode(ts, 'ts') +
               self.encode(counter, 'counter');
    };
    
    // Parse a uuid, returning an object with each component's original value.
    // ts is returned as a Date object, and resp will also include ip string like '?.?.<num>.<num>'
    generator.parse = function(str) {
        var self = this,
            validRegex = new RegExp('^[' + ALPHABET + ']{16}$');
            
        if (!validRegex.test(str)) {
            throw new Error('str is not a valid uuid');
        }
        
        return ['machineId', 'processId', 'ts', 'counter'].reduce(function(obj, type) {
            var typeLen = self.components[type].length,
                strPart = str.substr(0, typeLen);
            
            var val = self.decode(strPart);
            
            if (type === 'ts') {
                obj[type] = new Date(OLD_TS + val);
            } else {
                obj[type] = val;
            }
            
            if (type === 'machineId') {
                obj.ip = '?.?.' + (val >> 8) + '.' + (val & 0xff);
            }

            str = str.substr(typeLen);
            
            return obj;
        }, {});
    };
    
    // Publicly-usable versions of generator.generate() and generator.parse()
    uuid.createUuid = generator.generate.bind(generator);
    
    uuid.parseUuid = generator.parse.bind(generator);
    
    // Return a randomly-generated uuid of a given length (default 20 chars), using same alphabet.
    // NOTE: these are NOT guaranteed unique, and should NOT be used alongside uuids from createUuid
    uuid.randomUuid = function(len) {
        len = len || 20;
        var str = '';
        
        for (var i = 0; i < len; i++) {
            var rand = uuid.randInt(ALPHABET.length);
            str = str + ALPHABET.charAt(rand);
        }
        
        return str;
    };
    

    // keep generator private outside of unit tests
    if (__ut__) {
        uuid.generator = generator;
    }
    module.exports = uuid;
}());
