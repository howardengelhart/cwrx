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
var fs = require('fs-extra');
var userData = [];


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
    json: true
};

rp(options1)
    .then(function (parsedBody) {
        authToken = parsedBody.access_token;

        //Initialize Cursor to -1
        var cursor = -1;

        function getFollowers(cursor, authToken)  {
          var options2 =  {
                      uri: 'https://api.twitter.com/1.1/followers/list.json?screen_name='+ userName +'&skip_status=true&include_user_entities=false&cursor='+cursor,
            headers:  {
                    'User-Agent': 'Reelcontent',
                    'Authorization': 'Bearer ' + authToken,
            },
            json: true
          };

            return rp(options2)

            .then(function(twitterResponse) {
              numFollowers += twitterResponse.users.length;
              twitterResponse.users.forEach(function(entry)
              {
                var screen_name = entry.screen_name + "";
                var user_id = entry.id + "";
                console.log("\n" + screen_name);
                console.log(user_id);

                userData.push(screen_name + "," + user_id);
              });

              //change cursor value to next_cursor to print out next page of results
              cursor = twitterResponse.next_cursor;

              if (cursor == 0) //cursor on final page
              {
                console.log("Total Number of Followers: " + numFollowers);
                return;
              }
              else
              {
                return getFollowers(cursor, authToken);
              }

            })
            .catch(function(err){
              if (err.statusCode == 429)  {
                console.log("Twitter rate limit exceeded. Try later.");
              }
              else {
                console.log('request failed');
                console.log(util.inspect(err));
                return q.reject(err);
              }
            });
        }
        return getFollowers(cursor, authToken);
    })
      .then(function(body)  {
        fs.writeFile('out.csv', userData.join("\n"), function (err) {
          if (err)
            throw err;
          else
            console.log('It\'s saved!');
        });
      })
            .catch(function (err) {

                console.log("Authentification failed." + err);
            });
