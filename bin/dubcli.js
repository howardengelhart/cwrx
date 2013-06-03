var program = require('commander'),
    path    = require('path'),
    fs      = require('fs'),
    http    = require('http'),
    cwrx    = require(path.join(__dirname,'../../cwrx')),
    log     = cwrx.logger.createLog();


try {
    log.setLevel('INFO');
    main(function(err){
        if (err){
            log.error('Error: ' + err.message);
            process.exit(1);
        } else {
            process.exit(0);
        }
    });
} catch (err) {
    log.error('Error: ' + err.message);
    process.exit(1);
}

function main(done){
    var addr, data,opts,
        log = cwrx.logger.getLog();
   
    program
        .version('0.0.1')
        .option('-l, --loglevel [INFO]',
                'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)', 'INFO')
        .option('-s, --server [ADDR] ','Specify server ip:port [localhost:3000]','localhost:3000')
        .parse(process.argv);

    log.setLevel(program.loglevel);

    // This is a command line one-off
    if (!program.args[0]){
        throw new SyntaxError('Expected a template file.');
    }

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

    data = fs.readFileSync(program.args[0],{ encoding : 'utf8' });

    opts = {
        hostname : addr[0],
        port     : addr[1],
        path     : '/dub/create',
        method   : 'POST',
        headers  : {
                    'content-type'   : 'application/json',
                    'content-length' : data.length
        }
    };

    req = http.request(opts,function(res){
        log.info('Status Code: ' + res.statusCode);
        log.info('Headers: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        data = '';
        res.on('data',function(chunk){
            data += chunk;
        });
        res.on('end',function(){
            if (data){
                log.info('DATA: ' + data);
            }
            done();
        });
    });

    req.on('error',function(e){
        done(e);
    });

    req.write(data);

    req.end();
}
