var program = require('commander'),
    path    = require('path'),
    fs      = require('fs-extra'),
    http    = require('http'),
    crypto  = require('crypto'),
    cwrx    = require(path.join(__dirname,'../lib/index')),
    log     = cwrx.logger.createLog();

try {
    main(function(rc){
        process.exit(rc);    
    });
} catch(e){
    console.log(e.message);
    process.exit(1);
}

function replTempl(template,quotes){
    var result = JSON.parse(JSON.stringify(template)), qi;
    
    for (var i = 0; i < template.script.length; i++){
        qi = Math.floor(Math.random() * 999999999) % quotes.length;
        result.script[i].line = quotes[qi];
    }

    return result;
}

function sendRequest(host,port,template,iter, cb){
    var buff = JSON.stringify(template), opts, req, data, record = {},
        hash = crypto.createHash('sha1');

    record.iter = iter;
    record.start = new Date();
    
    opts = {
        hostname : host,
        port     : port,
        path     : '/dub/create',
        method   : 'POST',
        headers  : {
            'content-type'   : 'application/json',
            'content-length' : Buffer.byteLength(buff)
        }
    };

    req = http.request(opts,function(res){
        record.statusCode = parseInt(res.statusCode,10);
        if (record.statusCode !== 200){
//            console.log(buff);
        }
        res.setEncoding('utf8');
        data = '';
        res.on('data',function(chunk){
            data += chunk;
        });
        res.on('end',function(){
            // todo - verify file
            //if (data){
            //    log.info('DATA: ' + data);
           // }
            record.end = new Date();
            cb(null,record);
        });
    });

    req.on('error',function(e){
        console.log(e);
        console.log(buff);
        console.log(opts);
        process.exit(1);
        record.end = new Date();
        cb(e,record);
    });

    req.write(buff);

    req.end();

}

function summarize(passed,failed){
    var log = cwrx.logger.getLog(), durMin = 9999999999,durMax = 0 ,durAvg = 0, i, dur, durAgg = 0;

    log.info('Passed: ' + passed.length);
    for (i = 0; i < passed.length; i++){
        dur = (passed[i].end.valueOf() - passed[i].start.valueOf());
        if (dur < durMin) {
            durMin = dur;
        }

        if (dur > durMax) {
            durMax = dur;
        }

        durAgg += dur;
    }

    if (passed.length){
        durAvg = durAgg / passed.length;
    }

    log.info('min: ' + durMin);
    log.info('max: ' + durMax);
    log.info('avg: ' + durAvg);

    log.info('Failed: ' + failed.length);
}

function main(done){
    var addr, template,quotes,ptempl,passed = [],failed = [],
        log = cwrx.logger.getLog();

    program
        .version('0.0.1')
        .option('-i, --iterations [COUNT]',
                'Number of times to repeat attempts', 1)
        .option('-l, --loglevel [INFO]',
                'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)', 'INFO')
        .option('-s, --server [ADDR] ',
                'Specify server ip:port [localhost:3000]','localhost:3000')
        .option('-r, --replacements [file]',
                'Sepcify a file with lines to replace in script')
        .option('-t, --template [file] ',
                'Specify a template script file.')
        .parse(process.argv);

    log.setLevel(program.loglevel);

    addr = program.server.split(':');

    if (!addr[0]){
        throw new SyntaxError('Invalid server address: ' + program.server);
    }

    if (!addr[1]){
        addr[1] = 3000;
    } else {
        if (isNaN(addr[1])){
            throw new SyntaxError('Invalid server address: ' + program.server);
        }
        addr[1] = Number(addr[1]);
    }

    if (!program.template){
        throw new Error('The script requires a template.');
    }
    
    template = JSON.parse(fs.readFileSync(program.template,{ encoding : 'utf8' }));

    if (program.replacements){
        quotes = JSON.parse(fs.readFileSync(program.replacements,{ encoding : 'utf8' }));
        quotes = quotes.quotes;
    }

    program.iterations = parseInt(program.iterations,10);

    var i =0;

    process.nextTick(function doWork(){
        if (quotes){
            ptempl = replTempl(template,quotes);
        } else {
            ptempl = template;
        }

        sendRequest(addr[0],addr[1],ptempl,i,function(err,record){

            if (err){
                console.log('Send Request failed at:' + record.iter + ' with: ' + err);
                failed.push(record);
            }
            else {
                if (record.statusCode === 200){
                    passed.push(record);
                } else {
                    failed.push(record);
                }
            }

            log.info(record.iter + ',' + record.statusCode + ',' + (record.end.valueOf() - record.start.valueOf()));
            if ((passed.length + failed.length) === program.iterations){
                summarize(passed,failed);
                done(failed.length < 1 ? 0 : 1);
            }

        });

        if (++i < program.iterations){
            process.nextTick(doWork); 
        }
    });
}



