var fs = require('fs-extra');
var path = require('path');
var credsPath = path.join(process.env.home, '.twitter.creds.json');
var twitterCreds = fs.readJsonSync(credsPath);
var key = twitterCreds.key;
var secret = twitterCreds.secret;
//Concatenate Key + Secret and Encode to Base64
var KSBase64 = new Buffer(key + ":" + secret).toString('base64');
var userName = 'reelcontent';
var rp = require('request-promise');
var util = require('util');
var q = require('q');
var authToken;
var numFollowers = 0;
var userData = [];
var cursor = -1;


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

        function getFollowers(cursor, authToken)  {
          var options2 =  {
            uri: 'https://api.twitter.com/1.1/followers/list.json',
            qs: {
              screen_name: userName,
              include_user_entities: false,
              skip_status: true,
              cursor : cursor
            },
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

                userData.push(screen_name + "," + user_id);
              });

              //change cursor value to next_cursor to print out next page of results
              cursor = twitterResponse.next_cursor;

              if (cursor == 0) //cursor on final page
              {
                console.log("Fetched Users in Batch: " + numFollowers);
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
                return q.reject(err);
              }
            });
        }
        return getFollowers(cursor, authToken);
    })
      .then(function(body)  {
        fs.writeFileSync('out.csv', userData.join("\n"))
        console.log("File saved to 'out.csv'");
      })
      .catch(function (err) {
        delete err.response;
        console.log("Request failed." + util.inspect(err));
      });
