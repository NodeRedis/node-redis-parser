'use strict'

/* global BigInt */
const inspect = require('util').inspect
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
    return parseBigInt(parser)
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
  // This is kept for backwards compatibility with RESP2.
  // RESP3 is not going to trigger this.
  if (length < 0) {
    return null
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
  const tmp = parser.optionReturnBuffers
  parser.optionReturnBuffers = false
  var string = parseSimpleString(parser)
  parser.optionReturnBuffers = tmp
  if (string !== undefined) {
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
    parser.buffer,
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
  // This is kept for backwards compatibility with RESP2.
  // RESP3 is not going to trigger this.
  if (length < 0) {
    return null
  }
  const responses = new Array(length)
  parser.arrayDepth++
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
  if (parser.arrayCache.length !== 0) {
    const res = parseArrayChunks(parser)
    if (res === undefined) {
      pushArrayCache(parser, arr, pos)
      return
    }
    if (res !== attribute) {
      arr[pos++] = res
    }
  }
  return parseArrayElements(parser, arr, pos)
}

/**
 * Parse redis array response elements
 * @param {JavascriptRedisParser} parser
 * @param {any[]} responses
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

  parser.arrayDepth--

  if (parser.attribute === parser.arrayDepth) {
    if (parser.arrayDepth !== 0) {
      parser.attribute = -1
    }
    parser.optionReturnBuffers = parser.optionRptionReturnBuffersCache
    parser.emit('RESP:ATTRIBUTE', convertToMap(responses))
    return attribute
  }

  return responses
}

/**
 * Parse null
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|null}
 */
function parseNull (parser) {
  if (parser.offset + 2 > parser.buffer.length) {
    return
  }
  parser.offset += 2
  return null
}

/**
 * Returns the rest of a double
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|integer}
 */
function parseDoubleRest (parser, offset, length) {
  var number = 0
  var exp = 1

  while (offset < length) {
    const c1 = parser.buffer[offset++]
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      return number
    }
    exp *= 10
    number += (c1 - 48) / exp
  }
}

/**
 * Used for doubles only
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|number}
 */
function parseRegularDouble (parser) {
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0
  var sign = 1

  // Handle negative numbers.
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
      const res = parseDoubleRest(parser, offset, length)
      return res !== undefined ? sign * (number + res) : undefined
    }
    // An integer has been returned instead of an double.
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      return sign * number
    }
    number = (number * 10) + (c1 - 48)
  }
}

/**
 * Parses RESP3 doubles
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|number|string}
 */
function parseDouble (parser) {
  if (!parser.optionStringNumbers) {
    return parseRegularDouble(parser)
  }
  // Handle `,inf\r\n` and `,-inf\r\n`.
  if (parser.buffer.length - parser.offset >= 5) {
    const charCode = parser.buffer[parser.offset]
    if (charCode === 45) {
      if (parser.buffer.length - parser.offset >= 6 && parser.buffer[parser.offset + 1] === 105) {
        parser.offset += 6
        return '-Infinity'
      }
    } else if (charCode === 105) {
      parser.offset += 5
      return 'Infinity'
    }
  }
  const tmp = parser.optionReturnBuffers
  parser.optionReturnBuffers = false
  // TODO: It should be possible to improve the performance further by adding more
  // specialized functions as done with `parseStringNumbers()`.
  const string = parseSimpleString(parser)
  parser.optionReturnBuffers = tmp
  return string
}

/**
 * Parses RESP3 booleans
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|boolean}
 */
function parseBoolean (parser) {
  if (parser.buffer.length - parser.offset < 3) {
    return
  }
  const boolean = parser.buffer[parser.offset] === 116
  parser.offset += 3
  return boolean
}

/**
 * Helper function to convert a string into a Redis ReplyError including the
 * specific error code.
 *
 * @param {string} data
 * @returns {ReplyError}
 */
function convertToBlobError (data) {
  const codeEnd = data.indexOf(' ')
  const code = data.slice(0, codeEnd)
  const err = new ReplyError(data.slice(codeEnd + 1))
  err.code = code
  return err
}

/**
 * Parses RESP3 blob errors
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|ReplyError}
 */
// TODO: With a highly specialized function it's possible to parse the error
// code directly instead of having to parse it twice. The question is if it's
// worth it or not.
function parseBlobError (parser) {
  parser.returnBlobError = true
  parser.optionReturnBuffersCache = parser.optionReturnBuffers
  parser.optionReturnBuffers = false
  const string = parseBulkString(parser)
  if (string === undefined) {
    return
  }
  parser.returnBlobError = false
  parser.optionReturnBuffers = parser.optionReturnBuffersCache
  return convertToBlobError(string)
}

/**
 * Parses RESP3 BigInt
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|bigint|string}
 */
function parseBigInt (parser) {
  /* istanbul ignore if */
  if (!hasBigIntSupport) {
    return parseStringNumbers(parser)
  }
  const length = parser.buffer.length - 1
  var offset = parser.offset
  var number = 0
  var sign = true
  var res = ''

  if (parser.buffer[offset] === 45) {
    sign = false
    offset++
  }

  while (offset < length) {
    var c1 = parser.buffer[offset++]
    if (c1 === 13) { // \r\n
      parser.offset = offset + 1
      if (number !== 0) {
        res += number
      }
      return sign ? BigInt(res) : -BigInt(res)
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
 * Helper function to convert an array with key values into a map.
 *
 * @param {any[]} arr
 * @returns {Map}
 */
function convertToMap (arr) {
  const map = new Map()
  for (var i = 0; i < arr.length; i += 2) {
    map.set(arr[i], arr[i + 1])
  }
  return map
}

/**
 * Parses RESP3 sets
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|Set<any>}
 */
function parseSet (parser) {
  parser.returnSet = true
  const array = parseArray(parser)
  if (array === undefined) {
    return
  }
  parser.returnSet = false
  return new Set(array)
}

/**
 * Parses RESP3 maps
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|Map<any>}
 */
// TODO: It will also be significantly faster to implement a distinct function
// for maps and to change the generic return logic. Something similar should
// also be done for sets for performance reasons. This is however not trivial,
// especially due to the `attributes` type which could occur at any level.
function parseMap (parser) {
  // The structure is an array with tuples that represent the entries as in:
  // [key, value, key, value]
  parser.returnMap = true
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  const responses = new Array(length * 2)
  parser.arrayDepth++
  const array = parseArrayElements(parser, responses, 0)
  if (array === undefined) {
    return
  }
  parser.returnMap = false
  return convertToMap(array)
}

/**
 * Parses RESP3 attributes and sets the state accordingly to ignore the output.
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|symbol}
 */
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
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  const responses = new Array(length * 2)
  parser.attribute = parser.arrayDepth
  parser.arrayDepth++
  parser.optionRptionReturnBuffersCache = parser.optionReturnBuffers
  parser.optionReturnBuffers = false
  return parseArrayElements(parser, responses, 0)
}

/**
 * Sets the state for RESP3 push data and parses the incoming data.
 *
 * @param {JavascriptRedisParser} parser
 * @returns {undefined|any[]}
 */
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

/**
 * This function returns a function which in turn ignores or converts the parsed
 * data into the requested data type if necessary before passing it on to the
 * user.
 *
 * @param {JavascriptRedisParser} parser
 * @param {Function} reply
 * @param {undefined|Function} push
 * @returns {Function}
 */
function reply (parser, reply, push) {
  return function (data) {
    if (parser.attribute !== -1) {
      parser.attribute = -1
      return
    }
    if (parser.pushData) {
      parser.pushData = false
      return push(data)
    }
    if (parser.returnSet) {
      parser.returnSet = false
      return reply(new Set(data))
    }
    if (parser.returnMap) {
      parser.returnMap = false
      return reply(convertToMap(data))
    }
    if (parser.returnBlobError) {
      parser.returnBlobError = false
      parser.optionReturnBuffers = parser.optionReturnBuffersCache
      return reply(convertToBlobError(data))
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
    // This is optional to support RESP2.
    if (options.pushReply !== undefined && typeof options.pushReply !== 'function') {
      throw new TypeError('The pushReply option has to be of type function.')
    }
    super()
    this.optionReturnBuffers = false
    this.optionStringNumbers = false
    this.optionsBigInt = false
    if (options.returnBuffers !== undefined) this.setReturnBuffers(options.returnBuffers)
    if (options.stringNumbers !== undefined) this.setStringNumbers(options.stringNumbers)
    if (options.bigInt !== undefined) this.setBigInt(options.bigInt)
    this.returnError = options.returnError
    this.returnFatalError = options.returnFatalError || options.returnError
    this.returnReply = reply(this, options.returnReply, options.pushReply)
    this.optionReturnBuffersCache = this.optionReturnBuffers
    this.reset()
  }

  /**
   * Reset the parser values to the initial state
   *
   * @returns {undefined}
   */
  reset () {
    this.arrayDepth = 0
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
    /* istanbul ignore next */
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

  [inspect.custom] () {
    // Everything in here is considered internal. Therefore inspecting the
    // instance should not return any internal information.
    return inspect(this, { depth: -1, customInspect: false })
  }
}

module.exports = JavascriptRedisParser
