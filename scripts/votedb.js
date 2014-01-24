var conn = new Mongo('33.33.33.10'),
    db = conn.getDB('voteDb');

db.elections.insert({
    electionId: 'r-738c2403d83ddc',
    ballot:   {
        'rv-22119a8cf9f755' : {
            question : 'Good, bad or ugly?',
            returns  : [
                {
                    response : 'good and plenty',
                    votes : 100
                },
                {
                    response : 'bad and nasty',
                    votes    : 200
                },
                {
                    response : 'ugly and fat',
                    votes    : 300
                }
            ]
        },
        'rv-4770a2d7f85ce0' : {
            question : 'Smelly or not smelly?',
            returns  : [
                {
                    response : 'smelly',
                    votes    : 100
                },
                {
                    response : 'not smelly',
                    votes    : 200
                }
            ]
        }
    }
});

db.elections.update( { 
        'electionId'                                : 'r-738c2403d83ddc', 
        'ballot.rv-22119a8cf9f755.returns.response' : 'bad and nasty'
    }, 
    { 
        $inc : { 
            'ballot.rv-22119a8cf9f755.returns.$.votes' : 10000 
        } 
    } 
);

db.elections.update( { 
        'electionId'                                : 'r-738c2403d83ddc', 
        'ballot.rv-4770a2d7f85ce0.returns.response' : 'smelly'
    }, 
    { 
        $inc : { 
            'ballot.rv-4770a2d7f85ce0.returns.$.votes' : 1 
        } 
    } 
);

//db.elections.find().pretty();

//db.elections.drop();
