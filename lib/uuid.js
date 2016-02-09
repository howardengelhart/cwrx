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
    
    // Return 
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
    

    // NOTE: DO NOT CHANGE THESE
    var OLD_TS      = 1454366474119,
        ALPHABET    = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ~!';
    
    
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
    
    generator.components.counter.max = Math.pow(ALPHABET.length,
                                                generator.components.counter.length);
    generator.components.counter.start = uuid.randInt(generator.components.counter.max);
    generator.counter = generator.components.counter.start;

    
    generator.capValue = function(val, type) {
        return val % Math.pow(ALPHABET.length, this.components[type].length);
    };
    
    generator.getMachineId = function() {
        var ip = hostUtils.getIp(),
            ipMatch = ip.match(/(\d+)\.(\d+)$/),
            ipNums = [ parseInt(ipMatch[1]), parseInt(ipMatch[2]) ];
        
        return (ipNums[0] << 8) + ipNums[1];
    };
    
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
        
        while (str.length < desiredLength) {
            str = '0' + str;
        }
        
        return str;
    };
    
    generator.decode = function(str) {
        var val = 0;
            
        for (var i = 0; i < str.length; i++) {
            var charVal = ALPHABET.indexOf(str.charAt(i));
            val += ( charVal * Math.pow(ALPHABET.length, (str.length - i - 1)) );
        }
        
        return val;
    };
    
    generator.generate = function() {
        var self = this;

        var machineId = self.capValue(generator.getMachineId(), 'machineId');

        var processId = self.capValue(process.pid, 'processId'),
            ts = self.capValue(Date.now() - OLD_TS, 'ts');
        
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
    
    generator.parse = function(str) {
        var self = this;
        
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
    

    uuid.createUuid = generator.generate.bind(generator);
    
    uuid.parseUuid = generator.parse.bind(generator);
    

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
