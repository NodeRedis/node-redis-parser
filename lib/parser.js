'use strict'

var ReplyError = require('./replyError')

/**
 * Gather digits numerically, return string if Number overflow
 * 15 digits will not cause overflow, 16 can
 * Thanks @andrasq for the original
 * @param parser
 * @returns {*}
 */
function parseSimpleNumbers(parser) {
	var buf = parser.buffer, offset = parser.offset, length = buf.length
	var n = 0, m = 1, sign = ''

	if (buf[offset] === 0x2d) {
		sign = '-'
		offset++
	}

	var start = offset

	while (offset < length) {
		if (buf[offset] >= 0x30 && buf[offset] <= 0x39) { // '0'..'9'
			if (offset - start < 15) n = (n * 10) + buf[offset++] - 0x30
			else m = (m * 10) + buf[offset++] - 0x30
		}
		else if (buf[offset++] === 0x0a) { // '\n'
			parser.offset = offset
			if (offset - start > 15 && m !== 1) return sign + n + ('' + m).slice(1)
			return sign ? -n : n
		}
	}

	return undefined
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
		return parser.buffer.slice(start, end)
	}
	return parser.buffer.toString('utf-8', start, end)
}

/**
 * Parse a '+' redis simple string response but forward the offsets
 * onto convertBufferRange to generate a string.
 * @param parser
 * @returns {*}
 */
function parseSimpleStringViaOffset(parser) {
	var start = parser.offset
	var offset = parser.offset
	var length = parser.buffer.length

	while (offset < length) {
		var c1 = parser.buffer[offset++]
		if (c1 === 0x0d && parser.buffer[offset] === 0x0a) { // \r\n
			parser.offset = offset + 1
			return convertBufferRange(parser, start, offset - 1)
		}
	}
}

/**
 * Returns the string/array length via parseSimpleNumbers
 * @param parser
 * @returns {*}
 */
function parseLength(parser) {
	var length = parseSimpleNumbers(parser)
	if (length === -1) {
		return null
	}
	return length
}

/**
 * Parse a '$' redis bulk string response
 * @param parser
 * @returns {*}
 */
function parseBulkString(parser) {
	var length = parseLength(parser)
	
	if (length == null) {
		return length
	}

	var offsetEnd = parser.offset + length
	if (offsetEnd + 2 > parser.buffer.length) {
		parser.bufferCache.push(parser.buffer)
		parser.totalChunkSize = parser.buffer.length
		parser.bigStrSize = length + 2
		return
	}

	var offsetBegin = parser.offset
	parser.offset = offsetEnd + 2

	return convertBufferRange(parser, offsetBegin, offsetEnd)
}

/**
 * Parse a '-' redis error response
 * @param parser
 * @returns {Error}
 */
function parseError(parser) {
	var string = parseSimpleStringViaOffset(parser)
	if (string !== undefined) {
		if (parser.optionReturnBuffers === true) {
			string = string.toString()
		}
		return new ReplyError(string)
	}
}

/**
 * Parsing error handler, resets parser buffer
 * @param parser
 * @param error
 */
function handleError(parser, error) {
	parser.buffer = null
	parser.returnFatalError(error)
}

/**
 * Parse a '*' redis array response
 * @param parser
 * @returns {*}
 */
function parseArray(parser) {
	var length = parseLength(parser)
	
	if (length == null) {
		return length
	}
	var responses = new Array(length)
	var bufferLength = parser.buffer.length
	for (var i = 0; i < length; i++) {
		if (parser.offset >= bufferLength) {
			return
		}
		var response = parseType(parser, parser.buffer[parser.offset++])
		if (response === undefined) {
			return
		}
		responses[i] = response
	}

	return responses
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
			return parseBulkString(parser)
		case 58: // :
			return parseSimpleNumbers(parser)
		case 43: // +
			return parseSimpleStringViaOffset(parser)
		case 42: // *
			return parseArray(parser)
		case 45: // -
			return parseError(parser)
		default:
			return handleError(parser, new ReplyError('Protocol error, got ' + JSON.stringify(String.fromCharCode(type)) + ' as reply type byte'))
	}
}

/**
 * Javascript Redis Parser
 * @param options
 * @constructor
 */
function JavascriptRedisParser(options) {
	if (!(this instanceof JavascriptRedisParser)) {
		return new JavascriptRedisParser(options)
	}
	if (
		!options ||
		typeof options.returnError !== 'function' ||
		typeof options.returnReply !== 'function'
	) {
		throw new TypeError('Please provide all return functions while initiating the parser')
	}
	if (options.name === 'hiredis') {
		/* istanbul ignore next: hiredis is only supported for legacy usage */
		try {
			var Hiredis = require('../test/hiredis')
			console.error(new TypeError('Using the hiredis parser is discouraged. Please remove the name option.').stack.replace('Error', 'Warning'))
			return new Hiredis(options)
		} catch (e) {
			console.error(new TypeError('Hiredis is not installed. Please remove the `name` option. The (faster) JS parser is used instead.').stack.replace('Error', 'Warning'))
		}
	}
	this.optionReturnBuffers = !!options.returnBuffers
	this.optionStringNumbers = !!options.stringNumbers
	this.returnError = options.returnError
	this.returnFatalError = options.returnFatalError || options.returnError
	this.returnReply = options.returnReply
	this.name = 'javascript'
	this.offset = 0
	this.buffer = null
	this.bigStrSize = 0
	this.totalChunkSize = 0
	this.bufferCache = []
}


/**
 * Parse the redis buffer
 * @param buffer
 * @returns {undefined}
 */
JavascriptRedisParser.prototype.execute = function (buffer) {
	if (this.buffer === null) {
		this.buffer = buffer
		this.offset = 0
	} else if (this.bigStrSize === 0) {
		var oldLength = this.buffer.length
		var remainingLength = oldLength - this.offset
		var newLength = remainingLength + buffer.length
		var newBuffer = new Buffer(newLength)
		this.buffer.copy(newBuffer, 0, this.offset, oldLength)
		buffer.copy(newBuffer, remainingLength, 0, buffer.length)
		this.buffer = newBuffer
		this.offset = 0
	} else if (this.totalChunkSize + buffer.length >= this.bigStrSize) {
		this.bufferCache.push(buffer)
		if (this.offset !== 0) {
			this.bufferCache[0] = this.bufferCache[0].slice(this.offset)
		}
		this.buffer = Buffer.concat(this.bufferCache, this.totalChunkSize + buffer.length - this.offset)
		this.bigStrSize = 0
		this.totalChunkSize = 0
		this.bufferCache = []
		this.offset = 0
	} else {
		this.bufferCache.push(buffer)
		this.totalChunkSize += buffer.length
		return
	}

	var length = this.buffer.length

	while (this.offset < length) {
		var offset = this.offset
		var type = this.buffer[this.offset++]
		var response = parseType(this, type)
		if (response === undefined) {
			this.offset = offset
			return
		}

		if (type === 45) {
			this.returnError(response) // Errors -
		} else {
			this.returnReply(response) // Strings + // Integers : // Bulk strings $ // Arrays *
		}
	}

	this.buffer = null
}

module.exports = JavascriptRedisParser
