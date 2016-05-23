
var key = "qJ1bBAO0fYRcl39lDwCXYupgi";
var secret = "5WtgmtnlphsXGWuhhxMxg6HDrfvkOP0rW6RIrNUNKBBsRQ4FHe";
//Concatenate Key + Secret and Encode to Base64
var KSBase64 = new Buffer(key + ":" + secret).toString('base64');
var userName = 'reelcontent';
var rp = require('request-promise');
var util = require('util');
var authToken;

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
    .then(function (parsedBody) {
        authToken = parsedBody.access_token;
        console.log("Bearer Token Acquired:" + authToken);

        //Code to Get Follower List

          //Encode Bearer to Base64
          //var authToken64 = new Buffer(authToken).toString('base64');
          var followers;

          var options2 = {
              uri: 'https://api.twitter.com/1.1/followers/ids.json?cursor=-1&screen_name='+ userName +'&count=5000',
              headers: {
                      'User-Agent': 'Reelcontent',
                      'Authorization': 'Bearer ' + authToken,
                  },
              json: true // Automatically parses the JSON string in the response
              };

              rp(options2)
                  .then(function (parsedBody2) {
                      followers = util.inspect(parsedBody2);
                      console.log(followers);
                  })
             .catch(function (err2) {
                      console.log("Authentification failed. Follower List Not Acquired. " + err2);
                      console.log(authToken);
                  });





    })
    .catch(function (err) {
        console.log("Authentification failed. Bearer Token Not Acquired: " + util.inspect(err));
    });

/*



/*
//Get Bearer Token
POST /oauth2/token HTTP/1.1
Host: api.twitter.com
User-Agent: My Twitter App v1.0.23
Authorization: Basic base64
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
Content-Length: 29
Accept-Encoding: gzip
grant_type=client_credentials

//Request Follower List
GET /1.1/followers/ids.json?cursor=-1&screen_name=andypiper&count=5000 HTTP/1.1
Host: api.twitter.com
User-Agent: My Twitter App v1.0.23
Authorization: Bearer
Accept-Encoding: gzip*/
