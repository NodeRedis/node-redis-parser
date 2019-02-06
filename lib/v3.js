'use strict'

/* global BigInt */

const EventListener = require('events')
const Buffer = require('buffer').Buffer
const StringDecoder = require('string_decoder').StringDecoder
const decoder = new StringDecoder()
const errors = require('redis-errors')
const ReplyError = errors.ReplyError
const ParserError = errors.ParserError
const hasBigIntSupport = !/^v[0-9]\./.test(process.version)
const attribute = Symbol('attribute')
var bufferPool = Buffer.allocUnsafe(32 * 1024)
var bufferOffset = 0
var interval = null
var counter = 0
var notDecreased = 0

/**
 * Used for integer numbers only
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|integer}
 */
function parseSimpleNumbers (parser) {
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0
  var sign = 1

  if (parser.buffer[offset] === 45) {
    sign = -1
    offset++
  }

  while (offset < length) {
    const c1 = parser.buffer[offset++]
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      return sign * number
    }
    number = (number * 10) + (c1 - 48)
  }
}

/**
 * Used for integer numbers in case of the returnNumbers option
 *
 * Reading the string as parts of n SMI is more efficient than
 * using a string directly.
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|string}
 */
function parseStringNumbers (parser) {
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0
  var res = ''

  if (parser.buffer[offset] === 45) {
    res += '-'
    offset++
  }

  while (offset < length) {
    var c1 = parser.buffer[offset++]
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      if (number !== 0) {
        res += number
      }
      return res
    } else if (number > 429496728) {
      res += (number * 10) + (c1 - 48)
      number = 0
    } else if (c1 === 48 && number === 0) {
      res += 0
    } else {
      number = (number * 10) + (c1 - 48)
    }
  }
}

/**
 * Parse a '+' redis simple string response but forward the offsets
 * onto convertBufferRange to generate a string.
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|string|Buffer}
 */
function parseSimpleString (parser) {
  const start = parser.offset
  const buffer = parser.buffer
  const length = buffer.length - 1
  var offset = start

  while (offset < length) {
    if (buffer[offset++] === 13) { // \r\n
      parser.offset = offset + 1
      if (parser.optionReturnBuffers === true) {
        return parser.buffer.slice(start, offset - 1)
      }
      return parser.buffer.toString('utf8', start, offset - 1)
    }
  }
}

/**
 * Returns the read length
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|integer}
 */
function parseLength (parser) {
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0

  while (offset < length) {
    const c1 = parser.buffer[offset++]
    if (c1 === 13) {
      parser.offset = offset + 1
      return number
    }
    number = (number * 10) + (c1 - 48)
  }
}

/**
 * Parse a ':' redis integer response
 *
 * All numbers are returned as `bigint` if the `bigInt` option is active. If the
 * `stringNumbers` option is used, they will be returned as strings instead,
 *
 * This is important for big numbers (number > Math.pow(2, 53)) as js numbers
 * are 64bit floating point numbers with reduced precision.
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|integer|string|bigint}
 */
function parseInteger (parser) {
  if (parser.optionStringNumbers === true) {
    return parseStringNumbers(parser)
  }
  if (parser.optionBigInt === true) {
    const res = parseStringNumbers(parser)
    return res !== undefined ? BigInt(res) : undefined
  }
  return parseSimpleNumbers(parser)
}

/**
 * Parse a '$' redis bulk string response
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|null|string}
 */
function parseBulkString (parser) {
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  const offset = parser.offset + length
  if (offset + 2 > parser.buffer.length) {
    parser.bigStrSize = offset + 2
    parser.totalChunkSize = parser.buffer.length
    parser.bufferCache.push(parser.buffer)
    return
  }
  const start = parser.offset
  parser.offset = offset + 2
  if (parser.optionReturnBuffers === true) {
    return parser.buffer.slice(start, offset)
  }
  return parser.buffer.toString('utf8', start, offset)
}

/**
 * Parse a '-' redis error response
 * @param {JavascriptRedisParser} parser
 * @returns {ReplyError}
 */
function parseError (parser) {
  var string = parseSimpleString(parser)
  if (string !== undefined) {
    if (parser.optionReturnBuffers === true) {
      string = string.toString()
    }
    return new ReplyError(string)
  }
}

/**
 * Parsing error handler, resets parser buffer
 * @param {JavascriptRedisParser} parser
 * @param {integer} type
 * @returns {undefined}
 */
function handleError (parser, type) {
  const err = new ParserError(
    'Protocol error, got ' + JSON.stringify(String.fromCharCode(type)) + ' as reply type byte',
    JSON.stringify(parser.buffer),
    parser.offset
  )
  parser.buffer = null
  parser.returnFatalError(err)
}

/**
 * Parse a '*' redis array response
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|null|any[]}
 */
function parseArray (parser) {
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  const responses = new Array(length)
  return parseArrayElements(parser, responses, 0)
}

/**
 * Push a partly parsed array to the stack
 *
 * @param {JavascriptRedisParser} parser
 * @param {any[]} array
 * @param {integer} pos
 * @returns {undefined}
 */
function pushArrayCache (parser, array, pos) {
  parser.arrayCache.push(array)
  parser.arrayPos.push(pos)
}

/**
 * Parse chunked redis array response
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|any[]}
 */
function parseArrayChunks (parser) {
  var arr = parser.arrayCache.pop()
  var pos = parser.arrayPos.pop()
  if (parser.arrayCache.length) {
    const res = parseArrayChunks(parser)
    if (res === undefined) {
      pushArrayCache(parser, arr, pos)
      return
    }
    if (parser.arrayCache.length !== parser.attribute) {
      arr[pos++] = res
    } else {
      parser.attribute = -1
      parser.emit('RESP:ATTRIBUTE', convertToMap(res))
    }
  }
  return parseArrayElements(parser, arr, pos)
}

/**
 * Parse redis array response elements
 * @param {JavascriptRedisParser} parser
 * @param {Array} responses
 * @param {integer} i
 * @returns {undefined|null|any[]}
 */
function parseArrayElements (parser, responses, i) {
  const bufferLength = parser.buffer.length
  while (i < responses.length) {
    const offset = parser.offset
    if (parser.offset >= bufferLength) {
      pushArrayCache(parser, responses, i)
      return
    }
    const response = parseType(parser, parser.buffer[parser.offset++])
    if (response === undefined) {
      if (!(parser.arrayCache.length || parser.bufferCache.length)) {
        parser.offset = offset
      }
      pushArrayCache(parser, responses, i)
      return
    }
    if (response !== attribute) {
      responses[i] = response
      i++
    }
  }

  return responses
}

function parseNull (parser) {
  if (parser.offset + 2 > parser.buffer.length) {
    return
  }
  parser.offset += 2
  return null
}

/**
 * Used for doubles only
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|number}
 */
function parseSimpleDouble (parser) {
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0
  var sign = 1

  if (parser.buffer[offset] === 45) {
    sign = -1
    offset++
  }

  // Handle `,inf\r\n` and `,-inf\r\n`.
  if (parser.buffer[offset] === 105) {
    parser.offset = offset + 5
    return sign * Infinity
  }

  while (offset < length) {
    const c1 = parser.buffer[offset++]
    if (c1 === 46) { // .
      const tmp = parser.offset
      parser.offset = offset
      const res = parseLength(parser)
      if (res !== undefined) {
        // TODO: It might be possible to improve the performance a bit further
        // by using different tricks to calculate the double.
        return sign * (number + res / Math.pow(10, parser.offset - offset - 2))
      }
      parser.offset = tmp
      return
    }
    // An integer has been returned instead of an double.
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      return sign * number
    }
    number = (number * 10) + (c1 - 48)
  }
}

// TODO: It should be possible to improve the performance further by adding more
// specialized functions as done with `parseStringNumbers()`.
function parseDouble (parser) {
  if (parser.optionStringNumbers) {
    // Handle `,inf\r\n` and `,-inf\r\n`.
    if (parser.buffer[parser.offset] === 45 && parser.buffer[parser.offset + 1] === 105) {
      parser.offset += 6
      return '-Infinity'
    }
    if (parser.buffer[parser.offset] === 105) {
      parser.offset += 5
      return 'Infinity'
    }
    return parseSimpleString(parser)
  }
  const res = parseSimpleDouble(parser)
  if (res === undefined) {
    return
  }
  if (parser.optionsBigInt) {
    return BigInt(res)
  }
  return res
}

function parseBoolean (parser) {
  if (parser.offset + 3 > parser.buffer.length) {
    return
  }
  const res = parser.buffer[parser.offset] === 116
  parser.offset += 3
  return res
}

function convertToBlobError (parser, data) {
  if (parser.optionReturnBuffers === true) {
    data = data.toString()
  }
  const codeEnd = data.indexOf(' ')
  const code = data.slice(0, codeEnd)
  const err = new ReplyError(data.slice(codeEnd + 1))
  err.code = code
  return err
}

// TODO: With a highly specialized function it's possible to parse the error
// code directly instead of having to parse it twice. The question is if it's
// worth it or not.
function parseBlobError (parser) {
  parser.returnBlobError = true
  const res = parseBulkString(parser)
  if (res === undefined) {
    return
  }
  parser.returnBlobError = false
  return convertToBlobError(parser, res)
}

function parseBigInt (parser) {
  const res = parseStringNumbers(parser)
  if (res === undefined) {
    return
  }
  return hasBigIntSupport ? BigInt(res) : res
}

function convertToMap (arr) {
  const res = new Map()
  for (var i = 0; i < arr.length; i += 2) {
    res.set(arr[i], arr[i + 1])
  }
  return res
}

function parseSet (parser) {
  parser.returnSet = true
  const res = parseArray(parser)
  if (res === undefined) {
    return
  }
  parser.returnSet = false
  return new Set(res)
}

// TODO: It will also be significantly faster to implement a distinct function
// for maps and to change the generic return logic. Something similar should
// also be done for sets for performance reasons.
function parseMap (parser) {
  // The structure is an array with tuples that represent the entries as in:
  // [key, value, key, value]
  parser.returnMap = true
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  const responses = new Array(length * 2)
  const res = parseArrayElements(parser, responses, 0)
  if (res === undefined) {
    return
  }
  parser.returnMap = false
  return convertToMap(res)
}

// TODO: Find out how to properly use attributes...
function parseAttribute (parser) {
  // The parsed data should "somehow" be directed to the user without actually
  // returning the data to the user as other data types do. To make it useful
  // we'll have to make sure the context exists and the user is able to
  // understand where the attribute belongs too. To do so, we'll have to parse
  // the immediately following data and as soon as that's done, we could just
  // emit the attribute in combination with the parsed data. To make it a bit
  // more useful there could also be an intermediate receiver that adds the
  // command information to it as well and then sends it to the actual user.

  // However, adding such a logic is not trivial and might slow down the parser.
  // So as a starting point, just plainly emit the received information and
  // forget about it again.
  parser.attribute = parser.arrayCache.length
  const res = parseMap(parser)
  if (res !== undefined) {
    parser.emit('RESP:ATTRIBUTE', res)
    parser.attribute = -1
    return attribute
  }
}

// Happens only at the top level! Therefore we do not have to guard against
// weird things.
function parsePushData (parser) {
  parser.pushData = true
  return parseArray(parser)
}

/**
 * Called the appropriate parser for the specified type.
 *
 * @param {JavascriptRedisParser} parser
 * @param {number} type
 * @returns {*}
 */
function parseType (parser, type) {
  switch (type) {
    case 36: // $
    case 61: // =
      return parseBulkString(parser)
    case 43: // +
      return parseSimpleString(parser)
    case 42: // *
      return parseArray(parser)
    case 58: // :
      return parseInteger(parser)
    case 95: // _
      return parseNull(parser)
    case 35: // ,
      return parseBoolean(parser)
    case 44: // ,
      return parseDouble(parser)
    case 40: // (
      return parseBigInt(parser)
    case 37: // %
      return parseMap(parser)
    case 126: // ~
      return parseSet(parser)
    case 62: // >
      return parsePushData(parser)
    case 45: // -
      return parseError(parser)
    case 33: // !
      return parseBlobError(parser)
    case 124: // |
      return parseAttribute(parser)
    default:
      return handleError(parser, type)
  }
}

// Attribute: Like the Map type, but the client should keep reading the reply
// ignoring the attribute type, and return it to the client as additional
// information.

// TODO: This has to be implemented in the client, not the parser.
// Hello: Like the Map type, but is sent only when the connection between the
// client and the server is established, in order to welcome the client with
// different information like the name of the server, its version, and so forth.

/**
 * Decrease the bufferPool size over time
 *
 * Balance between increasing and decreasing the bufferPool.
 * Decrease the bufferPool by 10% by removing the first 10% of the current pool.
 * @returns {undefined}
 */
function decreaseBufferPool () {
  if (bufferPool.length > 50 * 1024) {
    if (counter === 1 || notDecreased > counter * 2) {
      const minSliceLen = Math.floor(bufferPool.length / 10)
      const sliceLength = minSliceLen < bufferOffset
        ? bufferOffset
        : minSliceLen
      bufferOffset = 0
      bufferPool = bufferPool.slice(sliceLength, bufferPool.length)
    } else {
      notDecreased++
      counter--
    }
  } else {
    clearInterval(interval)
    counter = 0
    notDecreased = 0
    interval = null
  }
}

/**
 * Check if the requested size fits in the current bufferPool.
 * If it does not, reset and increase the bufferPool accordingly.
 *
 * @param {number} length
 * @returns {undefined}
 */
function resizeBuffer (length) {
  if (bufferPool.length < length + bufferOffset) {
    const multiplier = length > 1024 * 1024 * 75 ? 2 : 3
    if (bufferOffset > 1024 * 1024 * 111) {
      bufferOffset = 1024 * 1024 * 50
    }
    bufferPool = Buffer.allocUnsafe(length * multiplier + bufferOffset)
    bufferOffset = 0
    counter++
    if (interval === null) {
      interval = setInterval(decreaseBufferPool, 50)
    }
  }
}

/**
 * Concat a bulk string containing multiple chunks
 *
 * Notes:
 * 1) The first chunk might contain the whole bulk string including the \r
 * 2) We are only safe to fully add up elements that are neither the first nor any of the last two elements
 *
 * @param {JavascriptRedisParser} parser
 * @returns {String}
 */
function concatBulkString (parser) {
  const list = parser.bufferCache
  const oldOffset = parser.offset
  var chunks = list.length
  var offset = parser.bigStrSize - parser.totalChunkSize
  parser.offset = offset
  if (offset <= 2) {
    if (chunks === 2) {
      return list[0].toString('utf8', oldOffset, list[0].length + offset - 2)
    }
    chunks--
    offset = list[list.length - 2].length + offset
  }
  var res = decoder.write(list[0].slice(oldOffset))
  for (var i = 1; i < chunks - 1; i++) {
    res += decoder.write(list[i])
  }
  res += decoder.end(list[i].slice(0, offset - 2))
  return res
}

/**
 * Concat the collected chunks from parser.bufferCache.
 *
 * Increases the bufferPool size beforehand if necessary.
 *
 * @param {JavascriptRedisParser} parser
 * @returns {Buffer}
 */
function concatBulkBuffer (parser) {
  const list = parser.bufferCache
  const oldOffset = parser.offset
  const length = parser.bigStrSize - oldOffset - 2
  var chunks = list.length
  var offset = parser.bigStrSize - parser.totalChunkSize
  parser.offset = offset
  if (offset <= 2) {
    if (chunks === 2) {
      return list[0].slice(oldOffset, list[0].length + offset - 2)
    }
    chunks--
    offset = list[list.length - 2].length + offset
  }
  resizeBuffer(length)
  const start = bufferOffset
  list[0].copy(bufferPool, start, oldOffset, list[0].length)
  bufferOffset += list[0].length - oldOffset
  for (var i = 1; i < chunks - 1; i++) {
    list[i].copy(bufferPool, bufferOffset)
    bufferOffset += list[i].length
  }
  list[i].copy(bufferPool, bufferOffset, 0, offset - 2)
  bufferOffset += offset - 2
  return bufferPool.slice(start, bufferOffset)
}

function reply (parser, reply, push) {
  return function (data) {
    if (parser.attribute !== -1) {
      parser.attribute = -1
      return parser.emit('RESP:ATTRIBUTE', data)
    }
    if (parser.pushData) {
      parser.pushData = false
      return push(data)
    }
    if (parser.returnSet) {
      parser.returnSet = false
      return push(new Set(data))
    }
    if (parser.returnMap) {
      parser.returnMap = false
      return reply(convertToMap(data))
    }
    if (parser.returnBlobError) {
      parser.returnBlobError = false
      return reply(convertToBlobError(parser, data))
    }
    return reply(data)
  }
}

class JavascriptRedisParser extends EventListener {
  /**
   * Javascript Redis Parser constructor
   * @param {{returnError: Function, returnReply: Function, returnFatalError?: Function, returnBuffers?: boolean, stringNumbers?: boolean, bigInt?: boolean }} options
   * @constructor
   */
  constructor (options) {
    if (!options) {
      throw new TypeError('Options are mandatory.')
    }
    if (typeof options.returnError !== 'function') {
      throw new TypeError('The returnError option has to be of type function.')
    }
    if (typeof options.returnReply !== 'function') {
      throw new TypeError('The returnReply option has to be of type function.')
    }
    // To separate concerns the parser should just plainly inform the client
    // about the incoming data. The client is then able to do what ever it
    // whishes with the received data.
    if (typeof options.pushReply !== 'function') {
      throw new TypeError('The pushReply option has to be of type function.')
    }
    super()
    this.optionReturnBuffers = false
    if (options.returnBuffers !== undefined) this.setReturnBuffers(options.returnBuffers)
    this.optionStringNumbers = false
    if (options.stringNumbers !== undefined) this.setStringNumbers(options.stringNumbers)
    this.optionsBigInt = false
    if (options.bigInt !== undefined) this.setBigInt(options.bigInt)
    this.returnError = options.returnError
    this.returnFatalError = options.returnFatalError || options.returnError
    this.returnReply = reply(this, options.returnReply, options.pushReply)
    this.reset()
  }

  /**
   * Reset the parser values to the initial state
   *
   * @returns {undefined}
   */
  reset () {
    this.attribute = -1
    this.returnBlobError = false
    this.returnMap = false
    this.returnSet = false
    this.pushData = false
    this.offset = 0
    this.buffer = null
    this.bigStrSize = 0
    this.totalChunkSize = 0
    this.bufferCache = []
    this.arrayCache = []
    this.arrayPos = []
  }

  /**
   * Set the returnBuffers option
   *
   * @param {boolean} returnBuffers
   * @returns {undefined}
   */
  setReturnBuffers (returnBuffers) {
    if (typeof returnBuffers !== 'boolean') {
      throw new TypeError('The returnBuffers argument has to be a boolean')
    }
    this.optionReturnBuffers = returnBuffers
  }

  /**
   * Set the stringNumbers option
   *
   * @param {boolean} stringNumbers
   * @returns {undefined}
   */
  setStringNumbers (stringNumbers) {
    if (typeof stringNumbers !== 'boolean') {
      throw new TypeError('The stringNumbers argument has to be a boolean')
    }
    if (this.optionBigInt) {
      throw new TypeError('`stringNumbers` can not be used in combination with the `bigInt` option')
    }
    this.optionStringNumbers = stringNumbers
  }

  /**
   * Set the bigInt option
   *
   * @param {boolean} bigInt
   * @returns {undefined}
   */
  setBigInt (bigInt) {
    if (typeof bigInt !== 'boolean') {
      throw new TypeError('The bigInt argument has to be a boolean')
    }
    if (this.optionStringNumbers) {
      throw new TypeError('`bigInt` can not be used in combination with the `stringNumbers` option')
    }
    if (!hasBigIntSupport) {
      throw new Error('BigInt is not supported for Node.js < v10.x')
    }
    this.optionBigInt = bigInt
  }

  /**
   * Parse the redis buffer
   * @param {Buffer} buffer
   * @returns {undefined}
   */
  execute (buffer) {
    if (this.buffer === null) {
      this.buffer = buffer
      this.offset = 0
    } else if (this.bigStrSize === 0) {
      const oldLength = this.buffer.length
      const remainingLength = oldLength - this.offset
      const newBuffer = Buffer.allocUnsafe(remainingLength + buffer.length)
      this.buffer.copy(newBuffer, 0, this.offset, oldLength)
      buffer.copy(newBuffer, remainingLength, 0, buffer.length)
      this.buffer = newBuffer
      this.offset = 0
      if (this.arrayCache.length) {
        const arr = parseArrayChunks(this)
        if (arr === undefined) {
          return
        }
        this.returnReply(arr)
      }
    } else if (this.totalChunkSize + buffer.length >= this.bigStrSize) {
      this.bufferCache.push(buffer)
      var tmp = this.optionReturnBuffers ? concatBulkBuffer(this) : concatBulkString(this)
      this.bigStrSize = 0
      this.bufferCache = []
      this.buffer = buffer
      if (this.arrayCache.length) {
        this.arrayCache[0][this.arrayPos[0]++] = tmp
        tmp = parseArrayChunks(this)
        if (tmp === undefined) {
          return
        }
      }
      this.returnReply(tmp)
    } else {
      this.bufferCache.push(buffer)
      this.totalChunkSize += buffer.length
      return
    }

    // TODO: Optimize the out of range a tiny bit.
    // We should not parse any data if we do not have at least three bytes e.g., `_\r\n`
    // (there is no data type that uses less than three bytes).
    while (this.offset < this.buffer.length) {
      const offset = this.offset
      const type = this.buffer[this.offset++]
      const response = parseType(this, type)
      if (response === undefined) {
        if (!(this.arrayCache.length || this.bufferCache.length)) {
          this.offset = offset
        }
        return
      }

      if (type === 45) {
        this.returnError(response)
      } else {
        this.returnReply(response)
      }
    }

    this.buffer = null
  }
}

module.exports = JavascriptRedisParser
