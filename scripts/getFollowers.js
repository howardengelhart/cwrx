
var key = "qJ1bBAO0fYRcl39lDwCXYupgi";
var secret = "5WtgmtnlphsXGWuhhxMxg6HDrfvkOP0rW6RIrNUNKBBsRQ4FHe";
//Concatenate Key + Secret and Encode to Base64
var KSBase64 = new Buffer(key + ":" + secret).toString('base64');
var userName = 'reelcontent';
var rp = require('request-promise');
var util = require('util');
var q = require('q');
var authToken;
var numFollowers = 0;
//getFollowers Function

//Request Bearer Token
var options1 = {
    method: 'POST',
    uri: 'https://api.twitter.com/oauth2/token',
    form: {
            'grant_type': 'client_credentials'
    },
    headers: {
        'User-Agent': 'Reelcontent',
        'Authorization': 'Basic ' + KSBase64,
    },
    json: true // Automatically parses the JSON string in the response
};

rp(options1)
    .then(function (parsedBody)
    {
        authToken = parsedBody.access_token;
        //Initialize Cursor to -1
        var cursor = -1;


        function getFollowers(cursor, authToken)
        {
          console.log("Calling getFollowers");
          var options2 =
          {
            uri: 'https://api.twitter.com/1.1/followers/list.json?screen_name='+ userName +'&skip_status=true&include_user_entities=false&cursor='+cursor,
            headers:
            {
                    'User-Agent': 'Reelcontent',
                    'Authorization': 'Bearer ' + authToken,
            },
            json: true
          };

            return rp(options2)

            .then(function(twitterResponse)
            {
              console.log('request succeeded');
              numFollowers += twitterResponse.users.length;
              twitterResponse.users.forEach(function(entry)
              {
                console.log("\n" + entry.screen_name),
                console.log(entry.id)
              });

              cursor = twitterResponse.next_cursor;
              console.log("Next cursor: " + cursor);

              if (cursor == 0)
              {
                console.log("Total Number of Followers: " + numFollowers);
                return;
              }
              else
              {
                console.log("In the return getFollowers() code");
                return getFollowers(cursor, authToken);
              }

            })
            .catch(function(err){
              console.log('request failed');
              console.log(util.inspect(err));
              return q.reject(err);
            });
          }

          return getFollowers(cursor, authToken);


    })
      .then(function(body){
        console.log("In final then handler");
      })
            .catch(function (err) {
            console.log("Authentification failed." + err);
          });
