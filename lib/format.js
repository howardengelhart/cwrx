(function(){
    'use strict';
    var basicFormat  = function(context,line){
            if (context){
                return '{' + context + '} ' + line;
            }
            return line;
        },
    
        extFormat   = function(context,line,args){
            if ((args === undefined) || (args === null) || (args.length < 1 )){
                return basicFormat(context,line,args);
            }
    
            var strLen = line.length, i = 0, pSt = -1,
                numStr = '', n=0, v='', c='',
                interpolated = basicFormat(context,'');
            for (i = 0; i < strLen; i++){
                c = line.charAt(i);
                if ((pSt > -1) && (c >= '0' && c <= '9')){
                    numStr += c;
                    continue;
                }
                if (c === '%'){
                    if (pSt === -1){
                        pSt = i;
                        continue;
                    }
    
                    // %% will be treated as an escape char
                    if (pSt === (i - 1)){
                        pSt = i;
                        interpolated += '%';
                        continue;
                    }
                }
    
                // If we got here then the char is not a number
                if (pSt > -1){
                    if (numStr.length > 0){
                        n = Number(numStr) - 1;
                        v = args[n];
                    } else {
                        v = '%';
                    }
                    interpolated += v;
                    pSt = -1;
                    numStr = '';
                }
                interpolated += c;
            }
    
            if (pSt > -1){
                if (numStr.length > 0){
                    n = Number(numStr) - 1;
                    v = args[n];
                } else {
                    v = '%';
                }
    
                interpolated += v;
            }
    
            return interpolated;
        };
    
    module.exports = function(ctxString){
        return function(logLine){
            return extFormat(ctxString,logLine,
                    Array.prototype.splice.call(arguments,1));
        };
    };
}());
