'use strict';

var ReplyError = require('./replyError');

/**
 * Used for lengths only, faster perf on arrays / bulks
 * @param parser
 * @returns {*}
 */
function parseSimpleString(parser) {
	var offset = parser.offset;
	var length = parser.buffer.length;
	var string = '';

	while (offset < length) {
		var c1 = parser.buffer[offset++];
		if (c1 === 13) {
			var c2 = parser.buffer[offset++];
			if (c2 === 10) {
				parser.offset = offset;
				return string;
			}
			string += String.fromCharCode(c1) + String.fromCharCode(c2);
			continue;
		}
		string += String.fromCharCode(c1);
	}
}

/**
 * Returns a string or buffer of the provided offset start and
 * end ranges. Checks `optionReturnBuffers`.
 * @param parser
 * @param start
 * @param end
 * @returns {*}
 */
function convertBufferRange(parser, start, end) {
	// If returnBuffers is active, all return values are returned as buffers besides numbers and errors
	if (parser.optionReturnBuffers === true) {
		return parser.buffer.slice(start, end);
	}

	return parser.buffer.toString('utf-8', start, end);
}

/**
 * Parse a '+' redis simple string response but forward the offsets
 * onto convertBufferRange to generate a string.
 * @param parser
 * @returns {*}
 */
function parseSimpleStringViaOffset(parser) {
	var start = parser.offset;
	var offset = parser.offset;
	var length = parser.buffer.length;

	while (offset < length) {
		var c1 = parser.buffer[offset++];
		if (c1 === 13) { // \r // Finding a \r is sufficient here, since in a simple string \r is always followed by \n
			parser.offset = offset + 1;
			return convertBufferRange(parser, start, offset - 1);
		}
	}
}

/**
 * Returns the string length via parseSimpleString
 * @param parser
 * @returns {*}
 */
function parseLength(parser) {
	var string = parseSimpleString(parser);
	if (string !== undefined) {
		var length = +string;
		if (length === -1) {
			return null;
		}
		return length;
	}
}

/**
 * Parse a ':' redis integer response
 * @param parser
 * @returns {*}
 */
function parseInteger(parser) {
	var string = parseSimpleString(parser);
	if (string !== undefined) {
		// If stringNumbers is activated the parser always returns numbers as string
		// This is important for big numbers (number > Math.pow(2, 53)) as js numbers
		// are 64bit floating point numbers with reduced precision
		if (parser.optionStringNumbers === false) {
			return +string;
		}
		return string;
	}
}

/**
 * Parse a '$' redis bulk string response
 * @param parser
 * @returns {*}
 */
function parseBulkString(parser) {
	var length = parseLength(parser);
	if (length === null || length === undefined) {
		return length;
	}
	var offsetEnd = parser.offset + length;
	if (offsetEnd + 2 > parser.buffer.length) {
		parser.bufferCache.push(parser.buffer);
		parser.totalChunkSize = parser.buffer.length;
		parser.bigStrSize = length + 2;
		return;
	}

	var offsetBegin = parser.offset;
	parser.offset = offsetEnd + 2;

	return convertBufferRange(parser, offsetBegin, offsetEnd);
}

/**
 * Parse a '-' redis error response
 * @param parser
 * @returns {Error}
 */
function parseError(parser) {
	var str = parseSimpleString(parser);
	if (str !== undefined) {
		return new ReplyError(str);
	}
}

/**
 * Parsing error handler, resets parser buffer
 * @param parser
 * @param error
 */
function handleError(parser, error) {
	parser.buffer = null;
	parser.returnFatalError(error);
}

/**
 * Parse a
 * @param parser
 * @returns {*}
 */
function parseArray(parser) {
	var length = parseLength(parser);
	if (length === null || length === undefined) {
		return length;
	}

	var responses = new Array(length);
	var bufferLength = parser.buffer.length;
	for (var i = 0; i < length; i++) {
		if (parser.offset >= bufferLength) {
			return;
		}
		var response = parseType(parser, parser.buffer[parser.offset++]);
		if (response === undefined) {
			return;
		}
		responses[i] = response;
	}

	return responses;
}

/**
 * Called the appropriate parser for the specified type.
 * @param parser
 * @param type
 * @returns {*}
 */

function parseType(parser, type) {
	switch (type) {
		case 36: // $
			return parseBulkString(parser);
		case 58: // :
			return parseInteger(parser);
		case 43: // +
			return parser.optionReturnBuffers ? parseSimpleStringViaOffset(parser) : parseSimpleString(parser);
		case 42: // *
			return parseArray(parser);
		case 45: // -
			return parseError(parser);
		default:
			return handleError(parser, new ReplyError('Protocol error, got ' + JSON.stringify(String.fromCharCode(type)) + ' as reply type byte'));
	}
}

/**
 * Javascript Redis Parser
 * @param options
 * @constructor
 */
function JavascriptRedisParser(options) {
	if (!(this instanceof JavascriptRedisParser)) {
		return new JavascriptRedisParser(options);
	}
	if (
		!options ||
		typeof options.returnError !== 'function' ||
		typeof options.returnReply !== 'function'
	) {
		throw new TypeError('Please provide all return functions while initiating the parser');
	}
	if (options.name === 'hiredis') {
		try {
			var hiredis = require('../test/hiredis');
			return new hiredis(options);
		} catch (e) {}
	}
	this.optionReturnBuffers = !!options.returnBuffers;
	this.optionStringNumbers = !!options.stringNumbers;
	this.returnError = options.returnError;
	this.returnFatalError = options.returnFatalError || options.returnError;
	this.returnReply = options.returnReply;
	this.name = 'javascript';
	this.offset = 0;
	this.buffer = null;
	this.bigStrSize = 0;
	this.totalChunkSize = 0;
	this.bufferCache = [];
}

/**
 * Parse the redis buffer
 * @param buffer
 */
JavascriptRedisParser.prototype.execute = function (buffer) {
	if (this.buffer === null) {
		this.buffer = buffer;
		this.offset = 0;
	} else if (this.bigStrSize === 0) {
		var oldLength = this.buffer.length;
		var remainingLength = oldLength - this.offset;
		var newLength = remainingLength + buffer.length;
		var newBuffer = new Buffer(newLength);
		this.buffer.copy(newBuffer, 0, this.offset, oldLength);
		buffer.copy(newBuffer, remainingLength, 0, buffer.length);
		this.buffer = newBuffer;
		this.offset = 0;
	} else if (this.totalChunkSize + buffer.length >= this.bigStrSize) {
		this.bufferCache.push(buffer);
		if (this.offset !== 0) {
			this.bufferCache[0] = this.bufferCache[0].slice(this.offset);
		}
		this.buffer = Buffer.concat(this.bufferCache, this.totalChunkSize + buffer.length - this.offset);
		this.bigStrSize = 0;
		this.totalChunkSize = 0;
		this.bufferCache = [];
		this.offset = 0;
	} else {
		this.bufferCache.push(buffer);
		this.totalChunkSize += buffer.length;
		return;
	}

	var length = this.buffer.length;

	while (this.offset < length) {
		var offset = this.offset;
		var type = this.buffer[this.offset++];
		var response = parseType(this, type);
		if (response === undefined) {
			this.offset = offset;
			return;
		}

		if (type === 45) {
			this.returnError(response); // Errors -
		} else {
			this.returnReply(response); // Strings + // Integers : // Bulk strings $ // Arrays *
		}
	}

	this.buffer = null;
};

module.exports = JavascriptRedisParser;
