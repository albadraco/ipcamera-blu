'use strict';
var util = require('util');
var meshblu = require('meshblu');
var regedit = require('regedit');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var url = require('url');
var querystr = require('querystring');
var debug = require('debug');

var log = console.log;
var configuredCamera = 'DCS_5020L';


var knownCameras = { 
	DCS_5020L: {
		CameraModel: 'DCS_5020L',
		StreamProtocol: 'mjpg',
		IP_Camera_Host: '10.232.0.34',
		IP_Camera_Protocol: 'http',
		IP_Camera_Stream_Query: '/video/mjpg.cgi',
		IP_Camera_Command_Query: '/pantiltcontrol.cgi',
		IP_Camera_Port: 80,
		Cam_User: 'admin',
		Cam_Password: 'camPass$2'
	},
	Other: {
		CameraModel: 'Other',
		StreamProtocol: 'h.264',
		IP_Camera_Host: 'localhost',
		IP_Camera_Protocol: 'http',
		IP_Camera_Stream_Query: '/video',
		IP_Camera_Command_Query: '/movecamera.cgi',
		IP_Camera_Port: 80,
		Cam_User: 'admin',
		Cam_Password: 'password'
	}
};
var MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
	CameraAction: {
		type: 'string',
		required: true,
		default: 'home',
		enum: [ 
				'move-North',
		        'move-NorthEast',
				'move-East',
				'move-SouthEast', 
				'move-South', 
				'move-SouthWest', 
				'move-West', 
				'move-NorthWest', 
				'zoom', 
				'home',
		]
	},
	PanStepValue: {
		type: 'integer',
		default: 5,
		required: true
	},
	TiltStepValue: {
		type: 'integer',
		default: 5,
		required: true
	}
  }
};
var OPTIONS_SCHEMA = {
  type: 'object',
  properties: {
	CameraModel: {
		type: 'string',
		required: true,
		default: configuredCamera,
		enum: [ 'DCS_5020L', 'Other' ]		
	},
	StreamProtocol: {
		type: 'string',
		required: true,
		default: knownCameras[configuredCamera].StreamProtocol,
		enum: [ 'mjpg', 'h.264', 'h.323', 'sip' ]
	},
    IP_Camera_Host: {
		type: 'string',
		required: true,
		default: knownCameras[configuredCamera].IP_Camera_Host
	},
	IP_Camera_Protocol: {
		type: 'string',
		required: true,
		default: knownCameras[configuredCamera].IP_Camera_Protocol,
		enum: [ 'http', 'https', 'rtsp' ]
	},
	IP_Camera_Port: {
		type: 'integer',
		required: true,
		default: knownCameras[configuredCamera].IP_Camera_Port
	},
	IP_Camera_Stream_Query: {
		type: 'string',
		required: true,
		default: knownCameras[configuredCamera].IP_Camera_Stream_Query
	},
	IP_Camera_Command_Query: {
		type: 'string',
		required: true,
		default: knownCameras[configuredCamera].IP_Camera_Command_Query
	},
    Cam_User: {
      type: 'string',
      required: true,
	  default: knownCameras[configuredCamera].Cam_User
    },
    Cam_Password: {
      type: 'string',
      required: true,
	  default: knownCameras[configuredCamera].Cam_Password
    }
  }
};

function hasSameValues(currentConfig, newConfig) {	
	var retval = true;
	for(var property in currentConfig) {
		if (currentConfig[property] !== newConfig[property]) {
			log('=====> Property Changed FROM: ' + currentConfig[property]);
			log('                          TO: ' + newConfig[property]);
			retval = false;
		}
	}
	return retval;
}
function CameraAction(direction) {
	switch(direction) {
		case 'move-North': return 1;
		case 'move-NorthEast': return 2;
		case 'move-East': return 5;
		case 'move-SouthEast': return 8;
		case 'move-South': return 7;
		case 'move-SouthWest': return 6;
		case 'move-West': return 3;
		case 'move-NorthWest': return 0;
		case 'home': return 4;
	}
}
function EncodeAuthentication(user, password) {
	return new Buffer( user + ':' + password).toString('base64'); 
}
function UpdateCamera(oldoptions, newoptions) {
	if (hasSameValues(oldoptions, newoptions) != true) {
		log('onUpdateCamera', "New configuration set.");
		var cameraUrl = newoptions.IP_Camera_Protocol + '://' + newoptions.IP_Camera_Host + ':' + newoptions.IP_Camera_Port + newoptions.IP_Camera_Stream_Query;
		regedit.putValue({'HKCU\\Software\\IP Webcam': { 'url': { value: cameraUrl,type: "REG_SZ" }}}, function(err) { if (err) throw err; });					
		regedit.putValue({'HKCU\\Software\\IP Webcam': { 'username': { value: newoptions.Cam_User,type: "REG_SZ"}}}, function(err) {if (err) throw err;});
		regedit.putValue({'HKCU\\Software\\IP Webcam': { 'password': { value: newoptions.Cam_Password,type: "REG_SZ"}}}, function(err) {if (err) throw err;});		
		configuredCamera = newoptions.CameraModel;	
	} else {
		log('onUpdateCamera', "No configuration changes.");
	}
}
function Plugin(){
  this.options = {};
  this.messageSchema = MESSAGE_SCHEMA;
  this.optionsSchema = OPTIONS_SCHEMA;
  return this;
};

util.inherits(Plugin, EventEmitter);

Plugin.prototype.onMessage = function(message){
	log('onMessage: ' + message.payload.CameraAction);
	var payload = message.payload;  
	var self = this;

	var post_data = querystr.stringify({
		'PanSingleMoveDegree' : payload.PanStepValue,
		'TiltSingleMoveDegree' : payload.TiltStepValue,
		'PanTiltSingleMove' : CameraAction(payload.CameraAction)
	});
	var post_options = {
		host: self.options.IP_Camera_Host,
		port: self.options.IP_Camera_Port,
		path: self.options.IP_Camera_Command_Query,
		method: 'POST',
		headers: {
			'Authorization': 'Basic ' + EncodeAuthentication(self.options.Cam_User, self.options.Cam_Password),
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': post_data.length
		}
	}  
	var post_request = http.request(post_options, function(res) {
		res.setEncoding('utf8');
		res.on('data', function(chunk) {
			log('Response: ' + chunk);
		});
	});

	post_request.write(post_data);
	post_request.end();
};
Plugin.prototype.onConfig = function(device){
  log('onConfig', device.options);
  var newoptions = device.options;
  // Below was an attempt to be able to preset configuration data on a per-camera-model
  // BUT, the multi-changes in the services seem to have broken this one.. so I don't know
  // how to emit a config change that originates here.
  /*
  if (this.options.CameraModel !== newoptions.CameraModel) {
	  log("-----> difference in camera model FROM: " + this.options.CameraModel + " TO: " + newoptions.CameraModel);
	  // override current values with a known working default set.
	  newoptions = knownCameras[newoptions.CameraModel];
  }
  */
  UpdateCamera(this.options, newoptions);	
  this.setOptions(newoptions||{});
};
Plugin.prototype.setOptions = function(newoptions){
  this.options = newoptions;
};


module.exports = {
  messageSchema: MESSAGE_SCHEMA,
  optionsSchema: OPTIONS_SCHEMA,
  Plugin: Plugin
};
