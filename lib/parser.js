
function parseNVPStr() {
    var rawStr      = arguments[0],
        strlen      = rawStr.length,
        token_start = 0,
        index       = 0,
        i           = 0,
        useCb       = false,
        opts        = {
            'dInner'                : '=',
            'dOuter'                : ';',
            'startAt'               : 0,
            'endAt'                 : undefined,
            'requireClosingDelim'   : false
        },
        nvpRcv,
        optArg;
   
    if (arguments.length === 2){
        if (arguments[1] instanceof Function){
            nvpRcv = arguments[1];
        } else {
            optArg = arguments[1];
        }
    } else 
    if (arguments.length > 2) {
        optArg  = arguments[1];
        nvpRcv  = arguments[2];
    }

    if (optArg){
        Object.keys(opts).forEach(function(key){
            if (optArg[key] !== undefined) {
                opts[key] = optArg[key];
            }
        });
    }

    if (isNaN(opts.dOuter)){
        opts.dOuter = opts.dOuter.charCodeAt(0);
    }

    if (isNaN(opts.dInner)){
        opts.dInner = opts.dInner.charCodeAt(0);
    }

    if (nvpRcv instanceof Function){
        useCb = true;
    } else 
    if ((nvpRcv instanceof Object) === false){
        nvpRcv = {};
    }

    token_start = i = opts.startAt;
    if (opts.endAt) {
        if (opts.endAt < 0) {
            strlen += opts.endAt;
        } else {
            if (opts.endAt < strlen) {
                strlen = opts.endAt;
            }
        }
    }

    if (strlen == 0) {
        return;
    }

//    console.log('OPTS: ' + JSON.stringify(opts,null,3));
//    console.log('strlen: ' + strlen);
    for ( ;i < strlen; ) {
        
        for (; rawStr.charCodeAt(i) !== opts.dInner; ) {
            if (++i >= strlen) {
                throw new Error("inner delim[" + opts.dInner + "] not found at [" + i + "] [index=" + index + "]");
            }
        }
        var tag = rawStr.substring(token_start,i);
        token_start = ++i;
        
        for (; rawStr.charCodeAt(i) !== opts.dOuter; ) {
            if (++i >= strlen)  {
                if (opts.requireClosingDelim) {
                    throw new Error("outer delim[" + opts.dOuter + "] not found at [" + i + "] [index=" + index + "]");
                } else {
                    break;
                }
            }
        }

        var val = rawStr.substring(token_start,i);

        if (useCb){
            nvpRcv(tag, val, index++);
        } else {
            nvpRcv[tag] = val;
            index++;
        }

        token_start = ++i;
    }

    if (!useCb) {
        return nvpRcv;
    }

    return;
}

module.exports.parseNVPStr = parseNVPStr;
