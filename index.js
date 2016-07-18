var lwip = require('lwip');
var request = require('request');
var mysql = require('mysql');
var Color = require('color');
var CronJob = require('cron').CronJob;
var moment = require('moment');
var async = require('async');
var fs = require("fs");


// These are the URLs to the camera feeds
var cameras = [
  {
    url: "https://ftp.dmv.washingtondc.gov/w/gt1/video.jpg",
    start: 90,
    rate_of_change: .976,
    empty_seats: 38
  },
  {
    url: "https://ftp.dmv.washingtondc.gov/w/gt2/video.jpg",
    start: 100,
    rate_of_change: .969,
    empty_seats: 9
  },
  {
    url: "https://ftp.dmv.washingtondc.gov/w/gt4/video.jpg",
    start: 0,
    rate_of_change: .983,
    empty_seats: 24
  }
];

// Create pool of connections
var pool = mysql.createPool(process.env.CLEARDB_DATABASE_URL || "mysql://root@localhost/dmv");
pool.on("error", function(err){  
  console.log(err);
  pool.end();
});

// First, let's calculate the baseline amount of blue for each camera
async.eachOfSeries(cameras, function(camera, i, callback){
  
  // I've saved the photos of the empty DMV room, so let's open those
  fs.readFile("control_images/" + i + ".jpg", function(err, data){
    if(err) throw err;
    var body = new Buffer(data, 'binary');
    lwip.open(body, 'jpeg', function(err, image){
      if( err ) throw err;
      
      // Set the total amount of blue detected to zero
      camera.controlBlue = 0;
      for(y = camera.start; y <= 239; y++){
        for( x = 0; x <= 319; x++){
          var hsv = getHSV(image);
          var pixelScore = y - camera.start * camera.rate_of_change;
          camera.controlBlue += (hsv.h >=220 && hsv.h <= 240 && hsv.s > 30 && hsv.v > 30) ? pixelScore : 0;
        }
      }
      callback();
    });
  });
}, function(){
  console.log("Done setting baseline...");
});


// Set up a cron to run every minute
new CronJob('* * * * *', function() {
  
  // Get the current date and time
  timestamp = moment.utc();
  console.log(timestamp.format('YYYY-MM-DD HH:mm:ss'))

  // Set the number of empty seats detected
  var totalEmptySeats = 0;

  // Cycle through each of the cameras
  async.eachOfSeries(cameras, function(camera, i, callback){
    
    request({url: camera.url, encoding: 'binary'}, function(err, res, body){ 
      var body = new Buffer(body, 'binary');

      lwip.open(body, 'jpeg', function(err, image){
  			if(err) throw err;

        // Like above, set the total amount of blue detected to zero
  			var blue = 0;
  			for(y = camera.start; y <= 239; y++){
  				for( x = 0; x <= 319; x++){
  				  hsv = getHSV(image);
            pixelScore = y - camera.start * camera.rate_of_change;
  					blue += (hsv.h >=220 && hsv.h <= 240 && hsv.s > 30 && hsv.v > 30) ? pixelScore : 0;
  				}
  			}
        camera.percentBlue = blue / camera.controlBlue;
  			totalEmptySeats += camera.percentBlue * camera.empty_seats;
  			console.log("Camera " + (i+1) + ": " + camera.percentBlue);
  			callback();
      });
    });
  }, function(){
    pool.getConnection(function(err, connection){
      connection.query('INSERT INTO readings (timestamp, open_chairs) VALUES(?, ?)', [timestamp.format('YYYY-MM-DD HH:mm:ss'), totalEmptySeats], function(err){
        if( err ) throw err;
        connection.release();
      });
    });
  });
}).start();

function getHSV(image){
  return Color().rgb([image.getPixel(x,y).r, image.getPixel(x,y).g, image.getPixel(x,y).b]).hsv();
}