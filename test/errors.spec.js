'use strict'

/* eslint-env mocha */

var assert = require('assert')
var ReplyError = require('../lib/replyError')
var ParserError = require('../lib/parserError')
var RedisError = require('../lib/redisError')

describe('errors', function () {
  it('errors should have a stack trace with error message', function () {
    var err1 = new RedisError('test')
    var err2 = new ReplyError('test')
    var err3 = new ParserError('test', new Buffer(''), 0)
    assert(err1.stack)
    assert(err2.stack)
    assert(err3.stack)
    assert(/RedisError: test/.test(err1.stack))
    assert(/ReplyError: test/.test(err2.stack))
    assert(/ParserError: test/.test(err3.stack))
  })
})
