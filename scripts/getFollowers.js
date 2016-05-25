var fs = require('fs-extra');
var rp = require('request-promise');
var util = require('util');
var q = require('q');
var path = require('path');
var credsPath = path.join(process.env.home, '.twitter.creds.json');
var twitterCreds = fs.readJsonSync(credsPath);
var key = twitterCreds.key;
var secret = twitterCreds.secret;

//Concatenate Key + Secret and Encode to Base64
var KSBase64 = new Buffer(key + ":" + secret).toString('base64');
var authToken;
var numFollowers = 0;
var userData = [];
var noDups = [];
var cursor = -1;


//Check and Process Username Argument from Command Line
  if (process.argv[2] == null) {
    console.log("Error: Please provide username argument");
    process.exit();
  }
  else {
    userName = process.argv[2];
  }

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

        function removeDups(array) {
          noDups = array.filter( function (value, index) {
              if (array.indexOf(value) != index)
                return false;
              else return true;
          });
          userData = noDups.sort();
          numFollowers = userData.length;
        }

        function getFollowers(cursor, authToken)  {
          //Request Followers
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
              twitterResponse.users.forEach(function(entry)
              {
                var user_id = entry.id + "";
                var screen_name = entry.screen_name + "";
                var name = entry.name + "";
                userData.push(screen_name + "," + user_id + "," + name);
              });

              //Change Cursor Value to next_cursor to Print Out Next Page of Results
              cursor = twitterResponse.next_cursor;

              if (cursor == 0) //cursor on final page
              {
                removeDups(userData);
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
                removeDups(userData);
                console.log("Fetched Users in Batch: " + numFollowers);
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
