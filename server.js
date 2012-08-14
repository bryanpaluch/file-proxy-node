var http = require('http');
var WebSocketServer = require('websocket').server;
var restify = require('restify');
var formidable = require("formidable");
var restport = 80;
var path = require('path');
var emitter = new(require('events').EventEmitter); 
var mime = require('mime');
var fs = require('fs');
var bufferList = {};
var sessions = {};
function uploadTalkLive(req, res, next) {
	var form = new formidable.IncomingForm(); 
	console.log("live transfer attempted " + req.params.fileid);	
//	send_upload_start(req.params.fileid);
	var chunkindex =0;	
	

	form.onPart = function(part) {
		console.log("part info:");	
		console.log(part);	
		if(!part.filename){
		form.handlePart(part);
		}
		part.addListener('data',function(chunk){
		emitter.emit(req.params.fileid, chunk, chunkindex++);
		});
	}

	form.on('field', function (field, value){
		console.log('got a field');	
		console.log(field,value);
	})
	.on('end', function(){		
		console.log('upload completed');	
		res.send(200);	
		emitter.emit(req.params.fileid + '-end');	
		return next();
	});



	form.parse(req);
};
function uploadTalk(req, res, next) {
	var index = 0;
	bufferList[req.params.fileid] = [];	
	console.log("upload attempted" + req.params.fileid);	
	send_upload_start(req.params.fileid);	
	req.on('data', function(chunk)
	{
       	bufferList[req.params.fileid].push(chunk); 
	});
	
	req.on('end', function()
	{
		console.log("upload finished");
		res.send(200);	
		return next();
	});
	//return false;
}
function getTalk(req, res, next) {
	var index = 0;
	if(bufferList[req.params.fileid]){	
	res.write(bufferList[req.params.fileid][index]);
	res.on('drain',function() {
		index++; 
		if(index >= bufferList[req.params.fileid].length) {	
		res.end();
		}else {
		res.write(bufferList[req.params.fileid][index]);
		}
	});
	
	res.on('error',function(e)
	{
	console.log("something bad happened.. " + e);
	res.send(500);
	});
	res.on('close', function()
	{
	console.log("response closed");	
	});
	}else{
	console.log("no buffers available");
	res.send(200);
	}	
};	
function getTalkLive(req,res,next){
	emitter.on(req.params.fileid, function(chunk,index){
		res.write(chunk);
	});
	emitter.on(req.params.fileid + '-end', function(){
		res.end();
	});
}
function serve(req, res, next) {
	var fname = path.normalize('./public' + req.path);
	console.log('fname ' + fname);	
	res.contentType = mime.lookup(fname);
	var data = fs.createReadStream(fname)
	data.pipe(res)
	data.on('end', function (){
		return next(false);
	});
	return false;

}
var rest = restify.createServer();
rest.use(restify.queryParser());
rest.post('/api/talk/:fileid', uploadTalk);
rest.post('/api/talklive/:fileid/:filename', uploadTalkLive);
rest.get('/api/talk/:fileid',getTalk);
rest.get('/api/talklive/:fileid/:filename',getTalkLive);
rest.get(/\/static\/\S+/, serve);
rest.listen(restport, function() {
        console.log("rest port is ", restport);
});


var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
server.listen(8080, function() {
    console.log((new Date()) + ' Server is listening on port 8080');
});

wsServer = new WebSocketServer({ httpServer: server });

function originIsAllowed(origin) {
return true;
}

var connections = {};
var connectionIDCounter = 0;

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    
    var connection = request.accept(null, request.origin);

    connection.id = connectionIDCounter ++;
    connections[connection.id] = connection;

    console.log((new Date()) + ' Connection ID ' + connection.id + ' accepted.');
    connection.on('message', function (message) {
	if (message.type === 'utf8') {
		processWSmessage(JSON.parse(message.utf8Data), connection.id);	
	}	

    }); 
    connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected. ' +
                    "Connection ID: " + connection.id);

	delete connections[connection.id];
	});
});
function processWSmessage(data, id){
	console.log(data);
	console.log('id: ' + id);
	var action = data.action;
	switch (action){
		case 'newGetSession' :
			console.log("new get session request received");
			addSessionReceiver(id,data.sessionId);	
			break;
		case 'newUploadSession' :
			console.log("new upload session created");
			addSessionUploader(id, data.sessionId);
			break;
		case 'startTransferSession' :
			console.log("request to start transfer sending msg to receiver");
			send_upload_start(data.sessionId, data);	
			break;
		case 'ackTransferSession' :
			console.log("request received ack forwarding to upload to start");
			send_upload_ack(data.sessionId, data);	
			break;	
	}
	
}
function addSessionReceiver(id,sessionId){
	var session = sessions[sessionId];
	if(session){
		console.log("session already created adding connection");	
		session[id] = "receiver";
		sessions[sessionId] = session;
		}
	else{
	sessions[sessionId] = {};
	sessions[sessionId][id] = "receiver";
	}
	console.log(sessions);	
}
function addSessionUploader(id,sessionId){
	var session = sessions[sessionId];
	if(session){
		console.log("session already created adding connection");	
		session[id] = "uploader";
		sessions[sessionId] = session;
		}
	else{
	sessions[sessionId] = {};
	sessions[sessionId][id] = "uploader";
	}
	console.log(sessions);	
}
function send_upload_start(sessionId, data)
{
	var session = sessions[sessionId]
	if(session){
		console.log("session found");
		for (id in session)
		{
			if (session[id] == "receiver"){
			sendToConnectionId(id,data);	
			}
		}
	}
	
}
function send_upload_ack(sessionId, data)
{
	var session = sessions[sessionId]
	if(session){
		console.log("session found");
		for (id in session)
		{
			if (session[id] == "uploader"){
			sendToConnectionId(id,data);	
			}
		}
	}
	
}
function broadcast(data) {
    Object.keys(connections).forEach(function(key) {
        var connection = connections[key];
        if (connection.connected) {
            connection.send(data);
        }
    });
}

function sendToConnectionId(connectionID, data) {
    var connection = connections[connectionID];
    if (connection && connection.connected) {
        connection.send(JSON.stringify(data));
    }
}
