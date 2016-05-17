'use strict'

var ReplyError = require('./replyError')
var bufferPool = new Buffer(64 * 1024)
var interval = null

/**
 * Used for lengths and numbers only, faster perf on arrays / bulks
 * @param parser
 * @returns {*}
 */
function parseSimpleNumbers (parser) {
  var offset = parser.offset
  var length = parser.buffer.length
  var number = 0
  var sign = false

  if (parser.buffer[offset] === 45) {
    sign = true
    offset++
  }

  while (offset < length) {
    var c1 = parser.buffer[offset++]
    if (c1 === 13 && parser.buffer[offset] === 10) { // \r\n
      parser.offset = offset + 1
      return sign ? -number : number
    }
    number = (number * 10) + (c1 - 48)
  }
}

/**
 * Used for integer numbers in case of the returnNumbers option
 * @param parser
 * @returns {*}
 */
function parseStringNumbers (parser) {
  var offset = parser.offset
  var length = parser.buffer.length
  var number = ''

  if (parser.buffer[offset] === 45) {
    number += '-'
    offset++
  }

  while (offset < length) {
    var c1 = parser.buffer[offset++]
    if (c1 === 13 && parser.buffer[offset] === 10) { // \r\n
      parser.offset = offset + 1
      return number
    }
    number += c1 - 48
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
function convertBufferRange (parser, start, end) {
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
function parseSimpleStringViaOffset (parser) {
  var start = parser.offset
  var offset = parser.offset
  var length = parser.buffer.length

  while (offset < length) {
    if (parser.buffer[offset++] === 10) { // \r\n
      parser.offset = offset
      return convertBufferRange(parser, start, offset - 2)
    }
  }
}

/**
 * Returns the string length via parseSimpleNumbers
 * @param parser
 * @returns {*}
 */
function parseLength (parser) {
  var string = parseSimpleNumbers(parser)
  if (string !== undefined) {
    return +string
  }
}

/**
 * Parse a ':' redis integer response
 * @param parser
 * @returns {*}
 */
function parseInteger (parser) {
  // If stringNumbers is activated the parser always returns numbers as string
  // This is important for big numbers (number > Math.pow(2, 53)) as js numbers
  // are 64bit floating point numbers with reduced precision
  if (parser.optionStringNumbers) {
    return parseStringNumbers(parser)
  }
  return parseSimpleNumbers(parser)
}

/**
 * Parse a '$' redis bulk string response
 * @param parser
 * @returns {*}
 */
function parseBulkString (parser) {
  var length = parseLength(parser)
  if (length === undefined) {
    return
  }
  if (length === -1) {
    return null
  }
  var offsetEnd = parser.offset + length
  if (offsetEnd + 2 > parser.buffer.length) {
    parser.bigStrSize = offsetEnd + 2
    parser.bigOffset = parser.offset
    parser.totalChunkSize = parser.buffer.length
    parser.bufferCache.push(parser.buffer)
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
function parseError (parser) {
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
function handleError (parser, error) {
  parser.buffer = null
  parser.returnFatalError(error)
}

/**
 * Parse a '*' redis array response
 * @param parser
 * @returns {*}
 */
function parseArray (parser) {
  var length = parseLength(parser)
  if (length === undefined) {
    return
  }
  if (length === -1) {
    return null
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
function parseType (parser, type) {
  switch (type) {
    case 36: // $
      return parseBulkString(parser)
    case 58: // :
      return parseInteger(parser)
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

// All allowed options including their typeof value
var optionTypes = {
  returnError: 'function',
  returnFatalError: 'function',
  returnReply: 'function',
  returnBuffers: 'boolean',
  stringNumbers: 'boolean',
  name: 'string'
}

/**
 * Javascript Redis Parser
 * @param options
 * @constructor
 */
function JavascriptRedisParser (options) {
  if (!(this instanceof JavascriptRedisParser)) {
    return new JavascriptRedisParser(options)
  }
  if (!options || !options.returnError || !options.returnReply) {
    throw new TypeError('Please provide all return functions while initiating the parser')
  }
  for (var key in options) {
    if (typeof options[key] !== optionTypes[key]) {
      throw new TypeError('The options argument contains unkown properties or properties of a wrong type')
    }
  }
  if (options.name === 'hiredis') {
    /* istanbul ignore next: hiredis is only supported for legacy usage */
    try {
      var Hiredis = require('../test/hiredis')
      console.error(new TypeError('Using hiredis is discouraged. Please use the faster JS parser by removing the name option.').stack.replace('Error', 'Warning'))
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
  this.bigOffset = 0
  this.totalChunkSize = 0
  this.bufferCache = []
}

/**
 * Concat a bulk string containing multiple chunks
 * @param parser
 * @param buffer
 * @returns {String}
 */
function concatBigString (parser, buffer) {
  var list = parser.bufferCache
  var length = parser.bigStrSize
  var stringSize = length - parser.bigOffset - 2
  var res = list[0].toString('utf8', parser.bigOffset)
  for (var i = 1; i < list.length - 1; i++) {
    res += list[i].toString()
  }
  if (i > 1) {
    if (res.length + list[i].length <= stringSize) {
      res += list[i].toString()
    } else {
      res += list[i].toString('utf8', 0, list[i].length - 1)
    }
  }
  var offset = stringSize - res.length
  if (offset > 0) {
    res += buffer.toString('utf8', 0, offset)
  }
  parser.offset = offset + 2
  parser.bigOffset = 0
  return res
}

/**
 * Decrease the bufferPool size over time
 * @returns {undefined}
 */
function decreaseBufferPool () {
  if (bufferPool.length > 96 * 1024) {
    // Decrease the bufferPool by 16kb
    bufferPool = bufferPool.slice(0, bufferPool.length - 16 * 1024)
    // console.log(bufferPool.length)
  } else {
    clearInterval(interval)
    interval = null
  }
}

/**
 * Concat the collected chunks from parser.bufferCache
 * @param parser
 * @param length
 * @returns {Buffer}
 */
function concat (parser, length) {
  var list = parser.bufferCache
  var pos = 0
  if (bufferPool.length < length) {
    bufferPool = new Buffer(length)
    if (interval === null) {
      interval = setInterval(decreaseBufferPool, 50)
    }
  }
  for (var i = 0; i < list.length; i++) {
    list[i].copy(bufferPool, pos)
    pos += list[i].length
  }
  return bufferPool.slice(parser.offset, length)
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
    // ~ 5% speed increase over using new Buffer(length) all the time
    if (bufferPool.length < newLength) { // We can't rely on the chunk size
      bufferPool = new Buffer(newLength)
    }
    var newBuffer = bufferPool
    this.buffer.copy(newBuffer, 0, this.offset, oldLength)
    buffer.copy(newBuffer, remainingLength, 0, buffer.length)
    this.buffer = newBuffer.slice(0, newLength)
    this.offset = 0
  } else if (this.totalChunkSize + buffer.length >= this.bigStrSize) {
    // The returned type might be Array * (42) and in that case we can't improve the parsing currently
    if (this.optionReturnBuffers === false && this.buffer[this.offset] === 36) {
      this.returnReply(concatBigString(this, buffer))
      this.buffer = buffer
    } else { // This applies for arrays too
      this.bufferCache.push(buffer)
      this.buffer = concat(this, this.totalChunkSize + buffer.length)
      this.offset = 0
    }
    this.bigStrSize = 0
    this.totalChunkSize = 0
    this.bufferCache = []
  } else {
    this.bufferCache.push(buffer)
    this.totalChunkSize += buffer.length
    return
  }

  while (this.offset < this.buffer.length) {
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
