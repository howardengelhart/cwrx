var conn = new Mongo('33.33.33.100'),
    db = conn.getDB('voteDb');

db.elections.insert({
    id: 'e1',
    ballot:   {
        'b1' : {
            'red apple'      : 10,
            'yellow banana'  : 20,
            'orange carrot'  : 30
        },
        'b2' : {
            'one chicken'    : 10,
            'two ducks'      : 20
        }
    }
});


db.elections.insert({
    id: 'e2',
    ballot:   {
        'b1' : {
            'one fish'   : 10,
            'two fish'   : 20,
        },
        'b2' : {
            'red fish'   : 30,
            'blue fish'  : 40
        }
    }
});



/*
db.elections.update( { 
        'id' : 'r-738c2403d83ddc'
    }, 
    { 
        $inc : { 
         'ballot.rv-22119a8cf9f755.returns.good and plenty' : 10 ,
         'ballot.rv-22119a8cf9f755.returns.bad and nasty'   : 20 ,
         'ballot.rv-22119a8cf9f755.returns.ugly and fat'    : 30 ,
         'ballot.rv-4770a2d7f85ce0.returns.not smelly'      : 40  
        } 
    } 
);
*/
//db.elections.update( { 
//        'id' : 'r-738c2403d83ddc', 
//    }, 
//    { 
//        $inc : { 'ballot.rv-4770a2d7f85ce0.returns.not smelly' : 11 } 
//    } 
//);

//db.elections.find().pretty();

//db.elections.drop();
