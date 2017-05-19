'use strict'

const Buffer = require('safe-buffer').Buffer
const StringDecoder = require('string_decoder').StringDecoder
const decoder = new StringDecoder()
const errors = require('redis-errors')
const ReplyError = errors.ReplyError
const ParserError = errors.ParserError
var bufferPool = Buffer.allocUnsafe(32 * 1024)
var bufferOffset = 0
var interval = null
var counter = 0
var notDecreased = 0

/**
 * Used for lengths and numbers only, faster perf on arrays / bulks
 * @param parser
 * @returns {*}
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
 * The maximum possible integer to use is: Math.floor(Number.MAX_SAFE_INTEGER / 10)
 * Staying in a SMI Math.floor((Math.pow(2, 32) / 10) - 1) is even more efficient though
 *
 * @param parser
 * @returns {*}
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
 * @param parser
 * @returns {*}
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
 * @param parser
 * @returns {*}
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
 * If stringNumbers is activated the parser always returns numbers as string
 * This is important for big numbers (number > Math.pow(2, 53)) as js numbers
 * are 64bit floating point numbers with reduced precision
 *
 * @param parser
 * @returns {*}
 */
function parseInteger (parser) {
  if (parser.optionStringNumbers === true) {
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
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  if (length < 0) {
    return null
  }
  const offsetEnd = parser.offset + length
  if (offsetEnd + 2 > parser.buffer.length) {
    parser.bigStrSize = offsetEnd + 2
    parser.bigOffset = parser.offset
    parser.totalChunkSize = parser.buffer.length
    parser.bufferCache.push(parser.buffer)
    return
  }
  const start = parser.offset
  parser.offset = offsetEnd + 2
  if (parser.optionReturnBuffers === true) {
    return parser.buffer.slice(start, offsetEnd)
  }
  return parser.buffer.toString('utf8', start, offsetEnd)
}

/**
 * Parse a '-' redis error response
 * @param parser
 * @returns {Error}
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
  const length = parseLength(parser)
  if (length === undefined) {
    return
  }
  if (length < 0) {
    return null
  }
  const responses = new Array(length)
  return parseArrayElements(parser, responses, 0)
}

/**
 * Push a partly parsed array to the stack
 *
 * @param parser
 * @param elem
 * @param i
 * @returns {undefined}
 */
function pushArrayCache (parser, elem, pos) {
  parser.arrayCache.push(elem)
  parser.arrayPos.push(pos)
}

/**
 * Parse chunked redis array response
 * @param parser
 * @returns {*}
 */
function parseArrayChunks (parser) {
  const tmp = parser.arrayCache.pop()
  var pos = parser.arrayPos.pop()
  if (parser.arrayCache.length) {
    const res = parseArrayChunks(parser)
    if (res === undefined) {
      pushArrayCache(parser, tmp, pos)
      return
    }
    tmp[pos++] = res
  }
  return parseArrayElements(parser, tmp, pos)
}

/**
 * Parse redis array response elements
 * @param parser
 * @param responses
 * @param i
 * @returns {*}
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
      if (!parser.arrayCache.length) {
        parser.offset = offset
      }
      pushArrayCache(parser, responses, i)
      return
    }
    responses[i] = response
    i++
  }

  return responses
}

/**
 * Called the appropriate parser for the specified type.
 *
 * 36: $
 * 43: +
 * 42: *
 * 58: :
 * 45: -
 *
 * @param parser
 * @param type
 * @returns {*}
 */
function parseType (parser, type) {
  switch (type) {
    case 36:
      return parseBulkString(parser)
    case 43:
      return parseSimpleString(parser)
    case 42:
      return parseArray(parser)
    case 58:
      return parseInteger(parser)
    case 45:
      return parseError(parser)
    default:
      return handleError(parser, new ParserError(
        'Protocol error, got ' + JSON.stringify(String.fromCharCode(type)) + ' as reply type byte',
        JSON.stringify(parser.buffer),
        parser.offset
      ))
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
      const sliceLength = Math.floor(bufferPool.length / 10)
      if (bufferOffset <= sliceLength) {
        bufferOffset = 0
      } else {
        bufferOffset -= sliceLength
      }
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
 * @param length
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
 * @param parser
 * @returns {String}
 */
function concatBulkString (parser) {
  const list = parser.bufferCache
  var chunks = list.length
  var offset = parser.bigStrSize - parser.totalChunkSize
  parser.offset = offset
  if (offset <= 2) {
    if (chunks === 2) {
      return list[0].toString('utf8', parser.bigOffset, list[0].length + offset - 2)
    }
    chunks--
    offset = list[list.length - 2].length + offset
  }
  var res = decoder.write(list[0].slice(parser.bigOffset))
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
 * @param parser
 * @returns {Buffer}
 */
function concatBulkBuffer (parser) {
  const list = parser.bufferCache
  const length = parser.bigStrSize - parser.bigOffset - 2
  var chunks = list.length
  var offset = parser.bigStrSize - parser.totalChunkSize
  parser.offset = offset
  if (offset <= 2) {
    if (chunks === 2) {
      return list[0].slice(parser.bigOffset, list[0].length + offset - 2)
    }
    chunks--
    offset = list[list.length - 2].length + offset
  }
  resizeBuffer(length)
  const start = bufferOffset
  list[0].copy(bufferPool, start, parser.bigOffset, list[0].length)
  bufferOffset += list[0].length - parser.bigOffset
  for (var i = 1; i < chunks - 1; i++) {
    list[i].copy(bufferPool, bufferOffset)
    bufferOffset += list[i].length
  }
  list[i].copy(bufferPool, bufferOffset, 0, offset - 2)
  bufferOffset += offset - 2
  return bufferPool.slice(start, bufferOffset)
}

/**
 * Javascript Redis Parser
 * @param options
 * @constructor
 */
class JavascriptRedisParser {
  constructor (options) {
    if (!options) {
      throw new TypeError('Options are mandatory.')
    }
    if (typeof options.returnError !== 'function' || typeof options.returnReply !== 'function') {
      throw new TypeError('The returnReply and returnError options have to be functions.')
    }
    this.setReturnBuffers(!!options.returnBuffers)
    this.setStringNumbers(!!options.stringNumbers)
    this.returnError = options.returnError
    this.returnFatalError = options.returnFatalError || options.returnError
    this.returnReply = options.returnReply
    this.reset()
  }

  /**
   * Reset the parser values to the initial state
   *
   * @returns {undefined}
   */
  reset () {
    this.offset = 0
    this.buffer = null
    this.bigStrSize = 0
    this.bigOffset = 0
    this.totalChunkSize = 0
    this.bufferCache = []
    this.arrayCache = []
    this.arrayPos = []
  }

  /**
   * Set the returnBuffers option
   *
   * @param returnBuffers
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
   * @param stringNumbers
   * @returns {undefined}
   */
  setStringNumbers (stringNumbers) {
    if (typeof stringNumbers !== 'boolean') {
      throw new TypeError('The stringNumbers argument has to be a boolean')
    }
    this.optionStringNumbers = stringNumbers
  }

  /**
   * Parse the redis buffer
   * @param buffer
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
        if (!this.arrayCache.length) {
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
