var fs        = require('fs'),
    crypto    = require('crypto'),
    cksum     = crypto.createHash('sha1'),
    fname     = process.argv[2],
    buff = fs.readFileSync(fname);
                
    cksum.update(buff);
    console.log(fname + ': ' + buff.length + ' ' + cksum.digest('hex'));
