'use strict'

var util = require('util')

function ReplyError (message) {
  var limit = Error.stackTraceLimit
  Error.stackTraceLimit = 2
  Error.captureStackTrace(this, this.constructor)
  Error.stackTraceLimit = limit
  Object.defineProperty(this, 'name', {
    value: 'ReplyError',
    configurable: false,
    enumerable: false,
    writable: true
  })
  Object.defineProperty(this, 'message', {
    value: message || '',
    configurable: false,
    enumerable: false,
    writable: true
  })
}

util.inherits(ReplyError, Error)

module.exports = ReplyError
