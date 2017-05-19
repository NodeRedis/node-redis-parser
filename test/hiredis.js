'use strict'

const hiredis = require('hiredis')
const errors = require('redis-errors')
const ReplyError = errors.ReplyError
const ParserError = errors.ParserError

/**
 * Parse data
 * @param parser
 * @returns {*}
 */
function parseData (parser, data) {
  try {
    return parser.reader.get()
  } catch (err) {
    // Protocol errors land here
    // Reset the parser. Otherwise new commands can't be processed properly
    parser.reader = new hiredis.Reader(parser.options)
    parser.returnFatalError(new ParserError(err.message, JSON.stringify(data), -1))
  }
}

/**
 * Hiredis Parser
 * @param options
 * @constructor
 */
class HiredisReplyParser {
  constructor (options) {
    this.returnError = options.returnError
    this.returnFatalError = options.returnFatalError || options.returnError
    this.returnReply = options.returnReply
    this.name = 'hiredis'
    this.options = {
      return_buffers: !!options.returnBuffers
    }
    this.reader = new hiredis.Reader(this.options)
  }

  execute (data) {
    this.reader.feed(data)
    var reply = parseData(this, data)

    while (reply !== undefined) {
      if (reply && reply.name === 'Error') {
        this.returnError(new ReplyError(reply.message))
      } else {
        this.returnReply(reply)
      }
      reply = parseData(this, data)
    }
  }

  /**
   * Reset the parser values to the initial state
   *
   * @returns {undefined}
   */
  reset () {
    this.reader = new hiredis.Reader(this.options)
  }
}

module.exports = HiredisReplyParser
