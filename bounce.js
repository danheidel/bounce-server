var bouncy = require('bouncy');
var fs = require('fs');
var _ = require('underscore');
var configPath = '/var/www/pm2config.json';
var util = require('util');
var bounceVals = {
	bouncePort: -1,
	_404Port: -1,
	servers:[]
};
var bounceServer;

fs.readFile(configPath, 'utf8', function(err, data){
	if(err){
		console.error('Error: ' + err);
		process.exit();
	}

	try{
		data = JSON.parse(data);
	} catch(e) {
		console.error('error parsing JSON.config ' + e);
		process.exit();
	}
	//console.dir(data);
	checkJSON(data);
});

function checkJSON(iJSON){
	var validParse = true;

	//test bounce server config
	var bounceConfig = _.findWhere(iJSON, {name: 'bounce-server'});
	if(typeof(bounceConfig) === 'undefined'){
		validParse = false;
		console.error('bounce server must be declared in config file');		
	}else if(bounceConfig.args.length != 1){
		validParse = false;
		console.error('bounce server must only have one port number');
	}else if(!isValidPort(bounceConfig.args[0])){
		validParse = false;
		console.error('bounce server port is invalid');
	}else{
		bounceVals.bouncePort = bounceConfig.args[0];
	}

	//test 404 server config
	var _404Config = _.findWhere(iJSON, {name: '404-server'});
	if(typeof(_404Config) === 'undefined'){
		validParse = false;
		console.error('404 server must be defined in config file');
	}else if(_404Config.args.length != 1){
		validParse = false;
		console.error('404 server must only have one port number');
	}else if(!isValidPort(_404Config.args[0])){
		validParse = false;
		console.error('404 server port is invalid');
	}else{
		bounceVals._404Port = _404Config.args[0];
	}

	//test destination servers
	_.each(_.reject(iJSON, function(elem){ 
			//don't parse bounce server or 404 server again, skip non bounce items
			return (elem.name == 'bounce-server' || elem.name == '404-server' || elem.bounce != true);
		}),
		function(elem, index){
			if(typeof(elem.name) === "undefined"){
				validParse = false;
				console.error('the server in ' + index + ' place has no name');
			}
			if(elem.args.length != 1){
				validParse = false;
				console.error(elem.name + ' can only have one defined port');
			}else if(!isValidPort(elem.args[0])){
				validParse = false;
				console.error(elem.name + ' port is invalid');
			}else{
				//valid destination server
				_.each(elem.urls, function(url, index){
					bounceVals.servers.push({
						port: elem.args[0],
						url: elem.urls[index]
					});
				}, elem);

				if(elem.urls.length < 1){
					//no URLs allowed but print a warning
					console.error(elem.name + ' has no defined URLs');
				}
			}
		}
	);

	console.log(util.inspect(bounceVals, {depth:null}));

	
	if(validParse == true){
		//console.log('config parsed successfully!');
		deEscalate();
		startBounceServer();
	}else{
		console.error('problem with config file, exiting');
		process.exit();
	}
}

function deEscalate(){
	//after reading config file (root level ownership) de-escalate user permissions
	var user = process.env.USERID || process.argv[2];
	if(!user){
		console.log('no user specified, exiting');
		process.exit();
	}
	try{
		process.setuid(user);
	} catch (e) {
		console.log('problem setting user');
		console.dir(e);
	}
}

function startBounceServer(){
	bounceServer = bouncy(function(req, res, bounce){
		var foundMatch = false;
		var baseHost = trimAt(req.headers.host,':');
		console.log('incoming request for: ' + baseHost);
		console.log('incoming client IP addr: ' + getClientIP(req));
		for(var rep=0;rep<bounceVals.servers.length;rep++){
			//console.log(bounceVals.servers[rep].url);
			if(bounceVals.servers[rep].url == baseHost){
				console.log('loading ' + baseHost);
				bounce(bounceVals.servers[rep].port);
				foundMatch = true;
			}
		}
		if(foundMatch == false){
			console.log('404! ' + baseHost);
			bounce(bounceVals._404Port);
		}
	});
	
	//engage server
	console.log(bounceVals.bouncePort);
	bounceServer.listen(bounceVals.bouncePort);
	console.log('bounce listening at: ' + bounceVals.bouncePort);
}

function isNumber(iNum){
	return !isNaN(parseFloat(iNum)) && isFinite(iNum);
}

function isValidPort(iNum){
	return isNumber(iNum) && (iNum > 0) && (iNum < 65536) && (iNum = Math.floor(iNum));
}

function trimAt(iString, iChar){
	if(typeof iString === 'undefined') {return ('null string');}
	var pos = iString.indexOf(iChar);
	if(pos > -1){
		return iString.substring(0, pos);
	}
	return iString;
}

function getClientIP(req){
	var ipAddress = req.headers['x-forwarded-for'];
	if(ipAddress) {return ipAddress[0];}
	else {ipAddress = req.connection.remoteAddress;}
	return ipAddress;
}
