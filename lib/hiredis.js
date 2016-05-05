'use strict';

var hiredis = require('hiredis');

/**
 * Parse data 
 * @param parser
 * @returns {*}
 */
function parseData(parser) {
	try {
		return parser.reader.get();
	} catch (err) {
		// Protocol errors land here
		// Reset the parser. Otherwise new commands can't be processed properly
		parser.reader = new hiredis.Reader(parser.options);
		parser.returnFatalError(err);
	}
}

/**
 * Hiredis Parser
 * @param options
 * @constructor
 */
function HiredisReplyParser(options) {
	this.name = 'hiredis';
	this.options = options;
	this.reader = new hiredis.Reader(options);
}

HiredisReplyParser.prototype.execute = function (data) {
	this.reader.feed(data);
	var reply = parseData(this);

	while (reply !== undefined) {
		if (reply && reply.name === 'Error') {
			this.returnError(reply);
		} else {
			this.returnReply(reply);
		}
		reply = parseData(this);
	}
};

module.exports = HiredisReplyParser;
