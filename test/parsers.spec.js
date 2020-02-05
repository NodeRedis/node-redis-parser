'use strict'

/* eslint-env mocha */
/* eslint-disable no-new */
/* global BigInt */

const assert = require('assert')
const util = require('util')
const Buffer = require('buffer').Buffer
const Parser = require('..')
const errors = require('redis-errors')
const ReplyError = errors.ReplyError
const ParserError = errors.ParserError
const RedisError = errors.RedisError
const hasBigIntSupport = !/^v[0-9]\./.test(process.version)

// Mock the not needed return functions
function returnReply (data) { console.log(data); throw new Error('failed') }
function returnError (err) { console.log(err); throw new Error('failed') }
function pushReply (data) { console.log(data); throw new Error('failed') }
function returnFatalError (err) { console.log(JSON.stringify(err.buffer.slice(err.offset).toString())); throw err }

function getBigInt (input, sign) {
  if (hasBigIntSupport) {
    return input === '-' ? -BigInt(sign) : BigInt(input)
  }
  return input === '-' ? input + sign : ('' + input)
}

function createBufferOfSize (parser, size, str) {
  if (size % 65536 !== 0) {
    throw new Error('Size may only be multiple of 65536')
  }
  str = str || ''
  const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
    'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
    'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
  const bigStringArray = (new Array(Math.pow(2, 16) / lorem.length).join(lorem + ' ')).split(' ') // Math.pow(2, 16) chars long
  const startBigBuffer = Buffer.from(str + '$' + size + '\r\n')
  const parts = size / 65536
  const chunks = new Array(parts)
  parser.execute(startBigBuffer)
  for (let i = 0; i < parts; i++) {
    chunks[i] = Buffer.from(bigStringArray.join(' ') + '.') // Math.pow(2, 16) chars long
    assert.strictEqual(parser.bufferCache.length, i + 1)
    parser.execute(chunks[i])
  }
  return chunks
}

function newParser (options, buffer) {
  if (typeof options === 'function') {
    options = {
      returnReply: options,
      returnBuffers: buffer === 'buffer'
    }
  }
  options.pushReply = options.pushReply || pushReply
  options.returnReply = options.returnReply || returnReply
  options.returnError = options.returnError || returnError
  options.returnFatalError = options.returnFatalError || returnFatalError
  return new Parser(options)
}

describe('parsers', function () {
  describe('general parser functionality', function () {
    it('fail for missing options argument', function () {
      assert.throws(function () {
        new Parser()
      }, function (err) {
        assert(err instanceof TypeError)
        return true
      })
    })

    it('fail for faulty options properties', function () {
      assert.throws(function () {
        new Parser({
          returnReply,
          returnError: true,
          pushReply
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The returnError option has to be of type function.')
        assert(err instanceof TypeError)
        return true
      })
      assert.throws(function () {
        new Parser({
          returnReply: true,
          returnError,
          pushReply
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The returnReply option has to be of type function.')
        assert(err instanceof TypeError)
        return true
      })
      assert.throws(function () {
        new Parser({
          pushReply: {},
          returnReply,
          returnError
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The pushReply option has to be of type function.')
        assert(err instanceof TypeError)
        return true
      })
    })

    it('should not fail for unknown options properties', function () {
      new Parser({
        returnReply,
        returnError,
        pushReply,
        bla: 6
      })
    })

    it('inspect should be minimal', function () {
      if (/^v[0-9]\./.test(process.version)) {
        return this.skip()
      }
      const inspected = util.inspect(new Parser({
        returnReply,
        returnError,
        pushReply,
        bla: 6
      }))
      assert.strictEqual(inspected, '[JavascriptRedisParser]')
    })

    it('reset returnBuffers option', function () {
      const res = 'test'
      let replyCount = 0
      function checkReply (reply) {
        if (replyCount === 0) {
          assert.strictEqual(reply, res)
        } else {
          assert.strictEqual(reply.inspect(), Buffer.from(res).inspect())
        }
        replyCount++
      }
      const parser = new Parser({
        returnReply: checkReply,
        returnError,
        pushReply
      })
      parser.execute(Buffer.from('+test\r\n'))
      parser.execute(Buffer.from('+test'))
      parser.setReturnBuffers(true)
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r\n$4\r\ntest\r\n'))
      assert.strictEqual(replyCount, 3)
    })

    it('reset returnBuffers option with wrong input', function () {
      const parser = new Parser({
        returnReply,
        returnError,
        pushReply
      })
      assert.throws(function () {
        parser.setReturnBuffers(null)
      }, function (err) {
        assert.strictEqual(err.message, 'The returnBuffers argument has to be a boolean')
        assert(err instanceof TypeError)
        return true
      })
    })

    it('reset stringNumbers option', function () {
      const res = 123
      let replyCount = 0
      function checkReply (reply) {
        if (replyCount === 0) {
          assert.strictEqual(reply, res)
        } else {
          assert.strictEqual(reply, String(res))
        }
        replyCount++
      }
      const parser = new Parser({
        returnReply: checkReply,
        returnError,
        pushReply
      })
      parser.execute(Buffer.from(':123\r\n'))
      assert.strictEqual(replyCount, 1)
      parser.setStringNumbers(true)
      parser.execute(Buffer.from(':123\r\n'))
      assert.strictEqual(replyCount, 2)
    })

    it('reset stringNumbers option with wrong input', function () {
      assert.throws(function () {
        new Parser({
          returnReply,
          returnError,
          pushReply,
          stringNumbers: 0
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The stringNumbers argument has to be a boolean')
        assert(err instanceof TypeError)
        return true
      })
      const parser = new Parser({
        returnReply,
        returnError,
        pushReply
      })
      assert.throws(function () {
        parser.setStringNumbers(null)
      }, function (err) {
        assert.strictEqual(err.message, 'The stringNumbers argument has to be a boolean')
        assert(err instanceof TypeError)
        return true
      })
    })

    it('reset bigInt option with wrong input', function () {
      assert.throws(function () {
        new Parser({
          returnReply,
          returnError,
          pushReply,
          bigInt: 0
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The bigInt argument has to be a boolean')
        assert(err instanceof TypeError)
        return true
      })
      const parser = new Parser({
        returnReply,
        returnError,
        pushReply
      })
      assert.throws(function () {
        parser.setBigInt(null)
      }, function (err) {
        assert.strictEqual(err.message, 'The bigInt argument has to be a boolean')
        assert(err instanceof TypeError)
        return true
      })
      if (/^v[0-9]\./.test(process.version)) {
        assert.throws(function () {
          new Parser({
            returnReply,
            returnError,
            pushReply,
            bigInt: true
          })
        }, function (err) {
          assert.strictEqual(err.message, 'BigInt is not supported for Node.js < v10.x')
          assert.strictEqual(err.name, 'Error')
          return true
        })
      }
    })
  })

  describe(Parser.name, function () {
    let replyCount = 0
    beforeEach(function () {
      replyCount = 0
    })

    describe('RESP3', function () {
      it('new data types', function () {
        var replyCount = 0
        var attribute = false
        const err = new ReplyError('invalid syntax')
        err.code = 'SYNTAX'
        var results = [[123.123, 123, new Set()], new Set([123, 'ttt']), new Map(), new Map([[[1, 2], Infinity], [false, err]])]
        function checkReply (reply) {
          assert.deepStrictEqual(reply, results[replyCount])
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.on('RESP:ATTRIBUTE', (data) => {
          assert.deepStrictEqual(data, new Map([[['ignore', 'txt:this'], new Set([null])]]))
          attribute = true
        })
        parser.execute(Buffer.from('*3\r\n,123.123\r\n,123\r\n~0\r\n~2\r\n,123.\r'))
        assert.strictEqual(replyCount, 1)
        parser.execute(Buffer.from('\n+ttt\r\n%0\r'))
        assert.strictEqual(replyCount, 2)
        parser.execute(Buffer.from('\n%2\r\n*2\r\n:1\r\n:2\r\n,inf\r\n|1\r\n*2\r\n+ignore\r\n=8'))
        assert.strictEqual(replyCount, 3)
        assert.strictEqual(attribute, false)
        parser.execute(Buffer.from('\r\ntxt:this\r\n~1\r\n_\r\n#f\r\n!21\r\nSYNTAX invalid syntax\r\n'))
        assert.strictEqual(attribute, true)
        assert.strictEqual(replyCount, 4)
      })

      it('more new data types', function () {
        var replyCount = 0
        var attribute = 0
        var pushs = 0
        const err = new ReplyError('foobar')
        err.code = 'WARNING'
        var results = [['123.123', '-123', '-Infinity'], 'Infinity', err, new Set([Buffer.from('abc')])]
        function checkReply (reply) {
          assert.deepStrictEqual(reply, results[replyCount])
          replyCount++
        }
        function pushReply (reply) {
          assert.deepStrictEqual(reply, ['pubsub', 'message', 'channel', 'foobar'].map(Buffer.from))
          pushs++
        }
        var parser = newParser({
          stringNumbers: true,
          returnBuffers: true,
          returnReply: checkReply,
          pushReply
        })
        parser.on('RESP:ATTRIBUTE', (data) => {
          assert.deepStrictEqual(data, new Map([['ignore this', true]]))
          attribute++
        })
        parser.execute(Buffer.from('*3\r\n,123.1'))
        parser.execute(Buffer.from('23\r\n|1\r'))
        assert.strictEqual(attribute, 0)
        parser.execute(Buffer.from('\n=11\r\nignore this\r\n#t\r\n,-12'))
        assert.strictEqual(attribute, 1)
        parser.execute(Buffer.from('3\r\n|1\r\n=11\r\nignore this\r\n#t\r'))
        assert.strictEqual(replyCount, 0)
        assert.strictEqual(attribute, 1)
        parser.execute(Buffer.from('\n,-inf\r\n,inf\r\n!14\r\nWARNING f'))
        assert.strictEqual(replyCount, 2)
        assert.strictEqual(attribute, 2)
        parser.execute(Buffer.from('oobar\r\n~1\r\n+ab'))
        assert.strictEqual(replyCount, 3)
        parser.execute(Buffer.from('c\r\n>4\r\n$6\r\npubsub\r\n+message\r\n+cha'))
        assert.strictEqual(replyCount, 4)
        assert.strictEqual(pushs, 0)
        parser.execute(Buffer.from('nnel\r\n=6\r\nfoobar\r\n|1\r\n=11\r\nignore this\r\n#t\r\n'))
        assert.strictEqual(pushs, 1)
        assert.strictEqual(attribute, 3)
      })
    })

    it('return numbers as bigint', function () {
      if (/^v[0-9]\./.test(process.version)) {
        return this.skip()
      }
      const entries = [
        getBigInt(123),
        getBigInt('590295810358705700002'),
        getBigInt('-', '99999999999999999'),
        getBigInt(4294967290),
        getBigInt('90071992547409920'),
        getBigInt('-', '10000040000000000000000000000000000000020')
      ]
      function checkReply (reply) {
        assert.strictEqual(typeof reply, 'bigint')
        assert.strictEqual(reply, entries[replyCount])
        replyCount++
      }
      const parser = newParser({
        returnReply: checkReply,
        bigInt: true
      })
      parser.execute(Buffer.from(':123\r\n:590295810358705700002\r\n:-99999999999999999\r\n:4294967290\r\n:900719925'))
      assert.strictEqual(replyCount, 4)
      parser.execute(Buffer.from('47409920\r\n:-10000040000000000000000000000000000000020\r\n'))
      assert.strictEqual(replyCount, 6)
    })

    it('reset parser', function () {
      function checkReply (reply) {
        assert.strictEqual(reply, 'test')
        replyCount++
      }
      const parser = newParser(checkReply)
      parser.execute(Buffer.from('$123\r\naaa'))
      parser.reset()
      parser.execute(Buffer.from('+test\r\n'))
      assert.strictEqual(replyCount, 1)
    })

    it('weird things', function () {
      var replyCount = 0
      var results = [[], '', [0, null, '', -0, '', []], 9223372036854776, '☃', [1, 'OK', null], null, 12345, [], null, 't']
      // Normalize output. The Hiredis parser does not parse `:-0\r\n` correctly as `-0`.
      if (Parser.name === 'HiredisReplyParser') {
        results[2][3] = 0
      }
      function checkReply (reply) {
        assert.deepStrictEqual(reply, results[replyCount])
        replyCount++
      }
      var parser = newParser(checkReply)
      parser.execute(Buffer.from('*0\r\n$0\r\n\r\n*6\r\n:\r\n$-1\r\n$0\r\n\r\n:-\r\n$'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('\r\n\r\n*\r\n:9223372036854775\r\n$' + Buffer.byteLength('☃') + '\r\n☃\r\n'))
      assert.strictEqual(replyCount, 5)
      parser.execute(Buffer.from('*3\r\n:1\r\n+OK\r\n$-1\r\n'))
      assert.strictEqual(replyCount, 6)
      parser.execute(Buffer.from('$-5'))
      assert.strictEqual(replyCount, 6)
      parser.execute(Buffer.from('\r\n:12345\r\n*0\r\n*-1\r\n+t\r\n'))
      assert.strictEqual(replyCount, 11)
    })

    it('good things', function () {
      var replyCount = 0
      var results = [[], '', [0, -Infinity, '', -0, '', []], 9223372036854776, '☃', [1, 'OK', getBigInt(123, 1)], null, 12345, [], true, 't']
      function checkReply (reply) {
        assert.deepStrictEqual(reply, results[replyCount])
        replyCount++
      }
      var parser = newParser(checkReply)
      parser.execute(Buffer.from('*0\r\n$0\r\n\r\n*6\r\n:\r\n,-inf\r\n$0\r\n\r\n:-\r\n$'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('\r\n\r\n*\r\n:9223372036854775\r\n$' + Buffer.byteLength('☃') + '\r\n☃\r\n'))
      assert.strictEqual(replyCount, 5)
      parser.execute(Buffer.from('*3\r\n:1\r\n+OK\r\n(123\r\n'))
      assert.strictEqual(replyCount, 6)
      parser.execute(Buffer.from('_'))
      assert.strictEqual(replyCount, 6)
      parser.execute(Buffer.from('\r\n:12345\r\n*0\r\n#t\r\n+t\r\n'))
      assert.strictEqual(replyCount, 11)
    })

    it('should not set the bufferOffset to a negative value', function (done) {
      const size = 64 * 1024
      function checkReply (reply) {}
      const parser = newParser(checkReply, 'buffer')
      createBufferOfSize(parser, size * 11)
      createBufferOfSize(parser, size, '\r\n')
      parser.execute(Buffer.from('\r\n'))
      setTimeout(done, 425)
    })

    it('multiple parsers do not interfere', function () {
      const results = [1234567890, 'foo bar baz', 'hello world']
      function checkReply (reply) {
        assert.strictEqual(reply, results[replyCount])
        replyCount++
      }
      const parserOne = newParser(checkReply)
      const parserTwo = newParser(checkReply)
      parserOne.execute(Buffer.from('+foo '))
      parserOne.execute(Buffer.from('bar '))
      assert.strictEqual(replyCount, 0)
      parserTwo.execute(Buffer.from(':1234567890\r\n+hello '))
      assert.strictEqual(replyCount, 1)
      parserTwo.execute(Buffer.from('wor'))
      parserOne.execute(Buffer.from('baz\r\n'))
      assert.strictEqual(replyCount, 2)
      parserTwo.execute(Buffer.from('ld\r\n'))
      assert.strictEqual(replyCount, 3)
    })

    it('multiple parsers do not interfere with bulk strings in arrays', function () {
      const results = [['foo', 'foo bar baz'], [1234567890, 'hello world', 'the end'], 'ttttttttttttttttttttttttttttttttttttttttttttttt']
      function checkReply (reply) {
        assert.deepStrictEqual(reply, results[replyCount])
        replyCount++
      }
      const parserOne = newParser(checkReply)
      const parserTwo = newParser(checkReply)
      parserOne.execute(Buffer.from('*2\r\n+foo\r\n$11\r\nfoo '))
      parserOne.execute(Buffer.from('bar '))
      assert.strictEqual(replyCount, 0)
      parserTwo.execute(Buffer.from('*3\r\n:1234567890\r\n$11\r\nhello '))
      assert.strictEqual(replyCount, 0)
      parserOne.execute(Buffer.from('baz\r\n+ttttttttttttttttttttttttt'))
      assert.strictEqual(replyCount, 1)
      parserTwo.execute(Buffer.from('wor'))
      parserTwo.execute(Buffer.from('ld\r\n'))
      assert.strictEqual(replyCount, 1)
      parserTwo.execute(Buffer.from('+the end\r\n'))
      assert.strictEqual(replyCount, 2)
      parserOne.execute(Buffer.from('tttttttttttttttttttttt\r\n'))
    })

    it('returned buffers do not get mutated', function () {
      const results = [Buffer.from('aaaaaaaaaa'), Buffer.from('zzzzzzzzzz')]
      function checkReply (reply) {
        assert.deepStrictEqual(results[replyCount], reply)
        results[replyCount] = reply
        replyCount++
      }
      const parser = newParser(checkReply, 'buffer')
      parser.execute(Buffer.from('$10\r\naaaaa'))
      parser.execute(Buffer.from('aaaaa\r\n'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('$10\r\nzzzzz'))
      parser.execute(Buffer.from('zzzzz\r\n'))
      assert.strictEqual(replyCount, 2)
      const str = results[0].toString()
      for (let i = 0; i < str.length; i++) {
        assert.strictEqual(str.charAt(i), 'a')
      }
    })

    it('chunks getting to big for the bufferPool', function () {
      // This is a edge case. Chunks should not exceed Math.pow(2, 16) bytes
      const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
        'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
        'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
      const bigString = (new Array(Math.pow(2, 17) / lorem.length + 1).join(lorem)) // Math.pow(2, 17) chars long
      const sizes = [4, Math.pow(2, 17)]
      function checkReply (reply) {
        assert.strictEqual(reply.length, sizes[replyCount])
        replyCount++
      }
      const parser = newParser(checkReply)
      parser.execute(Buffer.from('+test'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('\r\n+'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from(bigString))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r\n'))
      assert.strictEqual(replyCount, 2)
    })

    it('handles multi-bulk reply and check context binding', function () {
      function Abc () {}
      Abc.prototype.checkReply = function (reply) {
        assert.strictEqual(typeof this.log, 'function')
        assert.deepStrictEqual(reply, [['a']], 'Expecting multi-bulk reply of [["a"]]')
        replyCount++
      }
      Abc.prototype.log = console.log
      const test = new Abc()
      const parser = newParser({
        returnReply: function (reply) {
          test.checkReply(reply)
        }
      })

      parser.execute(Buffer.from('*1\r\n*1\r\n$1\r\na\r\n'))
      assert.strictEqual(replyCount, 1)

      parser.execute(Buffer.from('*1\r\n*1\r'))
      parser.execute(Buffer.from('\n$1\r\na\r\n'))
      assert.strictEqual(replyCount, 2)

      parser.execute(Buffer.from('*1\r\n*1\r\n'))
      parser.execute(Buffer.from('$1\r\na\r\n'))

      assert.strictEqual(replyCount, 3, 'check reply should have been called three times')
    })

    it('parser error', function () {
      function Abc () {}
      Abc.prototype.checkReply = function (err) {
        assert.strictEqual(typeof this.log, 'function')
        assert.strictEqual(err.message, 'Protocol error, got "a" as reply type byte')
        assert.strictEqual(err.name, 'ParserError')
        assert(err instanceof RedisError)
        assert(err instanceof ParserError)
        assert(err instanceof Error)
        assert(err.offset)
        assert(err.buffer)
        // assert(/\[97,42,49,13,42,49,13,36,49,96,122,97,115,100,13,10,97]/.test(err.buffer))
        // assert(/ParserError: Protocol error, got "a" as reply type byte/.test(util.inspect(err)))
        replyCount++
      }
      Abc.prototype.log = console.log
      const test = new Abc()
      const parser = newParser({
        returnFatalError: function (err) {
          test.checkReply(err)
        }
      })

      parser.execute(Buffer.from('a*1\r*1\r$1`zasd\r\na'))
      assert.strictEqual(replyCount, 1)
    })

    it('parser error resets the buffer', function () {
      let errCount = 0
      function checkReply (reply) {
        assert.strictEqual(reply.length, 1)
        assert(Buffer.isBuffer(reply[0]))
        assert.strictEqual(reply[0].toString(), 'CCC')
        replyCount++
      }
      function checkError (err) {
        assert.strictEqual(err.message, 'Protocol error, got "b" as reply type byte')
        errCount++
      }
      const parser = new Parser({
        returnReply: checkReply,
        returnError: checkError,
        returnFatalError: checkError,
        pushReply,
        returnBuffers: true
      })

      // The chunk contains valid data after the protocol error
      parser.execute(Buffer.from('*1\r\n+CCC\r\nb$1\r\nz\r\n+abc\r\n'))
      assert.strictEqual(replyCount, 1)
      assert.strictEqual(errCount, 1)
      parser.execute(Buffer.from('*1\r\n+CCC\r\n'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('-Protocol error, got "b" as reply type byte\r\n'))
      assert.strictEqual(errCount, 2)
    })

    it('parser error v3 without returnFatalError specified', function () {
      let errCount = 0
      function checkReply (reply) {
        assert.strictEqual(reply[0], 'OK')
        replyCount++
      }
      function checkError (err) {
        assert.strictEqual(err.message, 'Protocol error, got "\\n" as reply type byte')
        errCount++
      }
      const parser = new Parser({
        returnReply: checkReply,
        returnError: checkError,
        pushReply: pushReply
      })

      parser.execute(Buffer.from('*1\r\n+OK\r\n\n+zasd\r\n'))
      assert.strictEqual(replyCount, 1)
      assert.strictEqual(errCount, 1)
    })

    it('should handle \\r and \\n characters properly', function () {
      // If a string contains \r or \n characters it will always be send as a bulk string
      const entries = ['foo\r', 'foo\r\nbar', '\r\nСанкт-Пет', 'foo\r\n', 'foo', 'foobar', 'foo\r', 'äfooöü', 'abc']
      function checkReply (reply) {
        assert.strictEqual(reply, entries[replyCount])
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from('$4\r\nfoo\r\r\n$8\r\nfoo\r\nbar\r\n$19\r\n\r\n'))
      parser.execute(Buffer.from([208, 161, 208, 176, 208, 189, 208]))
      parser.execute(Buffer.from([186, 209, 130, 45, 208, 159, 208, 181, 209, 130]))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('\r\n$5\r\nfoo\r\n\r\n'))
      assert.strictEqual(replyCount, 4)
      parser.execute(Buffer.from('+foo\r'))
      assert.strictEqual(replyCount, 4)
      parser.execute(Buffer.from('\n$6\r\nfoobar\r'))
      assert.strictEqual(replyCount, 5)
      parser.execute(Buffer.from('\n$4\r\nfoo\r\r\n'))
      assert.strictEqual(replyCount, 7)
      parser.execute(Buffer.from('$9\r\näfo'))
      parser.execute(Buffer.from('oö'))
      parser.execute(Buffer.from('ü\r'))
      assert.strictEqual(replyCount, 7)
      parser.execute(Buffer.from('\n+abc\r\n'))
      assert.strictEqual(replyCount, 9)
    })

    it('line breaks in the beginning of the last chunk', function () {
      function checkReply (reply) {
        assert.deepStrictEqual(reply, [['a']], 'Expecting multi-bulk reply of [["a"]]')
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from('*1\r\n*1\r\n$1\r\na'))
      assert.strictEqual(replyCount, 0)

      parser.execute(Buffer.from('\r\n*1\r\n*1\r'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\n$1\r\na\r\n*1\r\n*1\r\n$1\r\na\r\n'))

      assert.strictEqual(replyCount, 3, 'check reply should have been called three times')
    })

    it('multiple chunks in a bulk string', function () {
      function checkReply (reply) {
        assert.strictEqual(reply, 'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij')
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from('$100\r\nabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('\r\n'))
      assert.strictEqual(replyCount, 1)

      parser.execute(Buffer.from('$100\r'))
      parser.execute(Buffer.from('\nabcdefghijabcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghij'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from(
        'abcdefghij\r\n' +
        '$100\r\nabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij\r\n' +
        '$100\r\nabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij'
      ))
      assert.strictEqual(replyCount, 3)
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij\r'))
      assert.strictEqual(replyCount, 3)
      parser.execute(Buffer.from('\n'))

      assert.strictEqual(replyCount, 4, 'check reply should have been called three times')
    })

    it('multiple chunks with arrays different types', function () {
      const predefinedData = [
        'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij',
        'test',
        100,
        new ReplyError('Error message'),
        ['The force awakens'],
        new ReplyError()
      ]
      function checkReply (reply) {
        for (let i = 0; i < reply.length; i++) {
          if (Array.isArray(reply[i])) {
            reply[i].forEach(function (reply, j) {
              assert.strictEqual(reply, predefinedData[i][j])
            })
          } else if (reply[i] instanceof Error) {
            assert(reply[i] instanceof ReplyError)
            assert.strictEqual(reply[i].name, predefinedData[i].name)
            assert.strictEqual(reply[i].message, predefinedData[i].message)
          } else {
            assert.strictEqual(reply[i], predefinedData[i])
          }
        }
        replyCount++
      }
      const parser = newParser({
        returnReply: checkReply,
        returnBuffers: false
      })

      parser.execute(Buffer.from('*6\r\n$100\r\nabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij'))
      parser.execute(Buffer.from('abcdefghijabcdefghijabcdefghij\r\n'))
      parser.execute(Buffer.from('+test\r'))
      parser.execute(Buffer.from('\n:100'))
      parser.execute(Buffer.from('\r\n-Error message'))
      parser.execute(Buffer.from('\r\n*1\r\n$17\r\nThe force'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from(' awakens\r\n-\r\n$5'))
      assert.strictEqual(replyCount, 1)
    })

    it('multiple chunks with nested partial arrays', function () {
      const predefinedData = [
        'abcdefghijabcdefghij',
        100,
        '1234567890',
        100
      ]
      function checkReply (reply) {
        assert.strictEqual(reply.length, 1)
        for (let i = 0; i < reply[0].length; i++) {
          assert.strictEqual(reply[0][i], predefinedData[i])
        }
        replyCount++
      }
      const parser = newParser({
        returnReply: checkReply
      })
      parser.execute(Buffer.from('*1\r\n*4\r\n+abcdefghijabcdefghij\r\n:100'))
      parser.execute(Buffer.from('\r\n$10\r\n1234567890\r\n:100'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('\r\n'))
      assert.strictEqual(replyCount, 1)
    })

    it('return normal errors', function () {
      function checkReply (reply) {
        assert.strictEqual(reply.message, 'Error message')
        replyCount++
      }
      const parser = newParser({
        returnError: checkReply
      })

      parser.execute(Buffer.from('-Error '))
      parser.execute(Buffer.from('message\r\n*3\r\n$17\r\nThe force'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from(' awakens\r\n$5'))
      assert.strictEqual(replyCount, 1)
    })

    it('return null', function () {
      function checkReply (reply) {
        assert.strictEqual(reply, null)
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from('_\r\n_'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r\n$1'))
      assert.strictEqual(replyCount, 2)
    })

    it('return value even if all chunks are only 1 character long', function () {
      function checkReply (reply) {
        assert.strictEqual(reply, 1)
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from(':'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('1'))
      parser.execute(Buffer.from('\r'))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('\n'))
      assert.strictEqual(replyCount, 1)
    })

    it('do not return before \\r\\n', function () {
      function checkReply (reply) {
        assert.strictEqual(reply, 1)
        replyCount++
      }
      const parser = newParser(checkReply)

      parser.execute(Buffer.from(':1\r\n:'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('1'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\n'))
      assert.strictEqual(replyCount, 2)
    })

    it('return data as buffer if requested', function () {
      function checkReply (reply) {
        if (Array.isArray(reply)) {
          reply = reply[0]
        }
        assert(Buffer.isBuffer(reply))
        assert.strictEqual(reply.inspect(), Buffer.from('test').inspect())
        replyCount++
      }
      const parser = newParser(checkReply, 'buffer')

      parser.execute(Buffer.from('+test\r\n'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('$4\r\ntest\r'))
      parser.execute(Buffer.from('\n'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('*1\r\n$4\r\nte'))
      parser.execute(Buffer.from('st\r'))
      parser.execute(Buffer.from('\n'))
      assert.strictEqual(replyCount, 3)
    })

    it('handle special case buffer sizes properly', function () {
      const entries = ['test test ', 'test test test test ', 1234]
      function checkReply (reply) {
        assert.strictEqual(reply, entries[replyCount])
        replyCount++
      }
      const parser = newParser(checkReply)
      parser.execute(Buffer.from('$10\r\ntest '))
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('test \r\n$20\r\ntest test test test \r\n:1234\r'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('\n'))
      assert.strictEqual(replyCount, 3)
    })

    it('return numbers as strings', function () {
      const entries = ['123', '590295810358705700002', '-99999999999999999', '4294967290', '90071992547409920', '10000040000000000000000000000000000000020']
      function checkReply (reply) {
        assert.strictEqual(typeof reply, 'string')
        assert.strictEqual(reply, entries[replyCount])
        replyCount++
      }
      const parser = newParser({
        returnReply: checkReply,
        stringNumbers: true
      })
      parser.execute(Buffer.from(':123\r\n:590295810358705700002\r\n:-99999999999999999\r\n:4294967290\r\n:90071992547409920\r\n:10000040000000000000000000000000000000020\r\n'))
      assert.strictEqual(replyCount, 6)
    })

    it('handle big numbers', function () {
      let number = 9007199254740991 // Number.MAX_SAFE_INTEGER
      function checkReply (reply) {
        assert.strictEqual(reply, number++)
        replyCount++
      }
      const parser = newParser(checkReply)
      parser.execute(Buffer.from(':' + number + '\r\n'))
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from(':' + number + '\r\n'))
      assert.strictEqual(replyCount, 2)
    })

    it('handle big data with buffers', function (done) {
      let chunks
      const replies = []
      const jsParser = Parser.name === 'JavascriptRedisParser'
      function checkReply (reply) {
        replies.push(reply)
        replyCount++
      }
      const parser = newParser(checkReply, 'buffer')
      parser.execute(Buffer.from('+test'))
      assert.strictEqual(replyCount, 0)
      createBufferOfSize(parser, 128 * 1024, '\r\n')
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r\n'))
      assert.strictEqual(replyCount, 2)
      setTimeout(function () {
        parser.execute(Buffer.from('+test'))
        assert.strictEqual(replyCount, 2)
        chunks = createBufferOfSize(parser, 256 * 1024, '\r\n')
        assert.strictEqual(replyCount, 3)
        parser.execute(Buffer.from('\r\n'))
        assert.strictEqual(replyCount, 4)
      }, 20)
      // Delay done so the bufferPool is cleared and tested
      // If the buffer is not cleared, the coverage is not going to be at 100
      setTimeout(function () {
        const totalBuffer = Buffer.concat(chunks).toString()
        assert.strictEqual(replies[3].toString(), totalBuffer)
        done()
      }, (jsParser ? 1400 : 40))
    })

    it('handle big data', function () {
      function checkReply (reply) {
        assert.strictEqual(reply.length, 4 * 1024 * 1024)
        replyCount++
      }
      const parser = newParser(checkReply)
      createBufferOfSize(parser, 4 * 1024 * 1024)
      assert.strictEqual(replyCount, 0)
      parser.execute(Buffer.from('\r\n'))
      assert.strictEqual(replyCount, 1)
    })

    it('handle big data 2 with buffers', function (done) {
      this.timeout(7500)
      const size = 111.5 * 1024 * 1024
      const replyLen = [size, size * 2, 11, 11]
      function checkReply (reply) {
        assert.strictEqual(reply.length, replyLen[replyCount])
        replyCount++
      }
      const parser = newParser(checkReply, 'buffer')
      createBufferOfSize(parser, size)
      assert.strictEqual(replyCount, 0)
      createBufferOfSize(parser, size * 2, '\r\n')
      assert.strictEqual(replyCount, 1)
      parser.execute(Buffer.from('\r\n+hello world'))
      assert.strictEqual(replyCount, 2)
      parser.execute(Buffer.from('\r\n$11\r\nhuge'))
      setTimeout(function () {
        parser.execute(Buffer.from(' buffer\r\n'))
        assert.strictEqual(replyCount, 4)
        done()
      }, 60)
    })
  })
})
