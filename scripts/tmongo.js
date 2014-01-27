var MongoClient = require('mongodb').MongoClient, q = require('q'), dbh, coll;

q.ninvoke(MongoClient,'connect','mongodb://33.33.33.10:27017/voteDb')
    .then(function(db){
        dbh = db;
        coll = db.collection('elections'); 
        return coll;
//        return q.ninvoke(coll,'findOne',{'id' : 'r-738c2403d83ddc'});
    })
//    .then(function(item){
//        console.log("findOne:",JSON.stringify(item,null,3));
//        return true;
//    })
    .then(function(){
        return q.ninvoke(coll,'findAndModify',
            { 'id' : 'r-738c2403d83ddcx'}, null, /*[['_id','asc']],*/
            { 
                $inc : { 
                 'ballot.rv-22119a8cf9f755.returns.good and plenty' : 99 ,
                 'ballot.rv-22119a8cf9f755.returns.bad and nasty'   : 99 ,
                 'ballot.rv-22119a8cf9f755.returns.ugly and fat'    : 99 ,
                 'ballot.rv-4770a2d7f85ce0.returns.not smelly'      : 99  
                } 
            }, 
            { new : true});
    })
    .then(function(result){
        console.log("findAndModify:",JSON.stringify(result,null,3));
        return true;
    })
    .catch(function(err){
        console.log("error:",err);
    })
    .done(function(){
        if (dbh){
            dbh.close();
        }
    });
