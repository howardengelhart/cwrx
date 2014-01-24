var MongoClient = require('mongodb').MongoClient, q = require('q'), dbh, coll;



q.ninvoke(MongoClient,'connect','mongodb://33.33.33.10:27017/voteDb')
    .then(function(db){
        dbh = db;
        coll = db.collection('elections'); 
        var cursor = coll.find({'electionId' : 'r-738c2403d83ddc'});
        return q.ninvoke(cursor,'nextObject');
    })
    .then(function(items){
        console.log("items:",items);
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
    collection.find({'electionId': '')}).toArray(function(err, items) {
        console.dir(items);
        // Let's close the db
        db.close();
    });
});
*/
