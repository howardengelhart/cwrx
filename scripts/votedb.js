var conn = new Mongo('33.33.33.10'),
    db = conn.getDB('voteDb');

db.elections.insert({
    id: 'r-738c2403d83ddc',
    ballot:   {
        'rv-22119a8cf9f755' : {
            question : 'Good, bad or ugly?',
            returns  : {
                'good and plenty'   : 100,
                'bad and nasty'     : 200,
                'ugly and fat'      : 300
            }
        },
        'rv-4770a2d7f85ce0' : {
            question : 'Smelly or not smelly?',
            returns  : {
                'smelly'     : 100,
                'not smelly' : 200
            }
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
