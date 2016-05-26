var fs = require('fs-extra');
var rp = require('request-promise');
var util = require('util');
var q = require('q');
var path = require('path');
var program = require('commander');
var credsPath = path.join(process.env.home, '.twitter.creds.json');
var twitterCreds = fs.readJsonSync(credsPath);
var key = twitterCreds.key;
var secret = twitterCreds.secret;
//Concatenate Key + Secret and Encode to Base64
var KSBase64 = new Buffer(key + ":" + secret).toString('base64');
var numFollowers = 0;
var userData = [];
var cursor = -1;
var uriCount = 5000;
var limit = 0;
var authToken;
var userName;
var idsOnly;
var prefVar;
var fileName;

program
  .version('0.0.1')
  .option('-u, --userName <name>','set username')
  .option('-a, --allInfo', 'get username, id\'s, and names')
  .option('-i, --idsOnly', 'get id\'s only')
  .option('-l, --limit <num>', 'set output limit [500]')
  .option('-f, --fileName <filename>', 'set file name [<username>followers.csv]')

  program.parse(process.argv);

//Handles No Username Input
if(!program.userName){
  console.log(program.help());
  process.exit();
}
else {
  userName = program.userName;
}
//Sets default to Ids-Only Request
if (!program.allInfo) {
  idsOnly = true;
  prefVar = "ids";
}
//Handles Conflicting Requests
else if(program.idsOnly){
  console.log("\n Error: Conflicting requests.");
  console.log(program.help());
  process.exit();
}
//Handles All-Info Request
else {
  idsOnly = false;
  prefVar = "list";
}

//Set limit
if (!program.limit) {
  limit = 500;
}
else {
  limit = parseInt(program.limit);
}

//Set Filename
if (!program.fileName) {
  fileName = userName + 'followers.csv';
}
else {
  fileName = program.fileName;
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

        function isDup(value, index, array) {
          if (array.indexOf(value) != index)  {
            return true;
          }
          else {
            return false;
          }
        }

        function getFollowers(cursor, authToken)  {
          //Request Followers
          var options2 =  {
            uri: 'https://api.twitter.com/1.1/followers/' + prefVar + '.json',
            qs: {
              screen_name: userName,
              include_user_entities: false,
              skip_status: true,
              cursor : cursor,
              count: uriCount
            },
            headers:  {
              'User-Agent': 'Reelcontent',
              'Authorization': 'Bearer ' + authToken,
            },
            json: true
          };

            return rp(options2)

            .then(function(twitterResponse) {

              if (idsOnly == false){
                twitterResponse.users.forEach(function(user) {
                  var user_id = user.id + "";
                  var screen_name = user.screen_name + "";
                  var name = user.name + "";
                  var pushVar = (screen_name + "," + user_id + "," + name);

                  if (userData.length === limit){
                    cursor = 0;
                    return;
                  }
                  else {
                    userData.push(pushVar);
                  }
                });
              }
              else{
                twitterResponse.ids.forEach(function(user,index) {
                    if (userData.length === limit){
                      cursor = 0;
                      return;
                    }
                    else {
                      if (isDup(user, index, twitterResponse.ids) === false)
                        userData.push(user);
                    }
                });
              }
              numFollowers = userData.length;
              userData.sort();

              //Change Cursor Value

              //Check for cursor on final page
              if (cursor === 0)
              {
                console.log("Fetched Users in Batch: " + numFollowers);
              }
              //Change cursor to print out next page of results
              else
              {
                cursor = twitterResponse.next_cursor;
                return getFollowers(cursor, authToken);
              }

            })
            .catch(function(err){
              if (err.statusCode === 429)  {
                console.log("Twitter rate limit exceeded. Try later.");
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
        fs.writeFileSync(fileName, userData.join("\n"))
        console.log("File saved to: " + fileName);
      })
      .catch(function (err) {
        delete err.response;
        console.log("Request failed." + util.inspect(err));
      });
