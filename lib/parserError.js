'use strict'

const assert = require('assert')
const RedisError = require('./redisError')

class ParserError extends RedisError {
  constructor (message, buffer, offset) {
    assert(buffer)
    assert.strictEqual(typeof offset, 'number')

    const tmp = Error.stackTraceLimit
    Error.stackTraceLimit = 2
    super(message)
    Error.stackTraceLimit = tmp
    this.offset = offset
    this.buffer = buffer
  }
}

Object.defineProperty(ParserError.prototype, 'name', {
  value: 'ParserError',
  configurable: true,
  writable: true
})

module.exports = ParserError
