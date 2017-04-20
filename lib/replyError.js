'use strict'

const RedisError = require('./redisError')

class ReplyError extends RedisError {
  constructor (message) {
    const tmp = Error.stackTraceLimit
    Error.stackTraceLimit = 2
    super(message)
    Error.stackTraceLimit = tmp
  }
}

Object.defineProperty(ReplyError.prototype, 'name', {
  value: 'ReplyError',
  configurable: true,
  writable: true
})

module.exports = ReplyError
