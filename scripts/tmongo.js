var MongoClient = require('mongodb').MongoClient, q = require('q'), dbh, coll;



q.ninvoke(MongoClient,'connect','mongodb://33.33.33.10:27017/voteDb')
    .then(function(db){
        dbh = db;
        coll = db.collection('elections'); 
        return q.ninvoke(coll,'findOne',{'id' : 'r-738c2403d83ddc'});
    })
    .then(function(item){
        console.log("items:",JSON.stringify(item,null,3));
    })
    .then(function(){
        return q.ninvoke(coll,'findAndModify',
            { 'id' : 'r-738c2403d83ddc', 'ballot.rv-4770a2d7f85ce0.returns.response' : 'smelly' }, [['_id','asc']],
            { $inc : { 'ballot.rv-4770a2d7f85ce0.returns.$.votes' : 9999999 } }, { new : true});
    })
    .then(function(item){
        console.log("items:",JSON.stringify(item,null,3));
    })
    .catch(function(err){
        console.log("error:",err);
    })
    .done(function(){
        if (dbh){
            dbh.close();
        }
    });
/*
console.log('done');

MongoClient.connect('mongodb://33.33.33.10:27017/voteDb', function(err, db) {
    if(err) throw err;
    var collection = db.collection('elections');
    collection.find({'id': '')}).toArray(function(err, items) {
        console.dir(items);
        // Let's close the db
        db.close();
    });
});
*/
