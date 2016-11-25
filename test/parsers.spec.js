'use strict'

/* eslint-env mocha */

var assert = require('assert')
var JavascriptParser = require('../')
var HiredisParser = require('../lib/hiredis')
var ReplyError = JavascriptParser.ReplyError
var parsers = [HiredisParser, JavascriptParser]

// Mock the not needed return functions
function returnReply () { throw new Error('failed') }
function returnError () { throw new Error('failed') }
function returnFatalError (err) { throw err }

describe('parsers', function () {
  describe('general parser functionality', function () {
    it('backwards compatibility with hiredis', function () {
      var parser = new JavascriptParser({
        returnReply: returnReply,
        returnError: returnError,
        name: 'hiredis'
      })
      assert.strictEqual(parser.name, 'hiredis')
    })

    it('fail for missing options argument', function () {
      assert.throws(function () {
        JavascriptParser()
      }, function (err) {
        assert.strictEqual(err.message, 'Please provide all return functions while initiating the parser')
        assert(err instanceof TypeError)
        return true
      })
    })

    it('fail for faulty options properties', function () {
      assert.throws(function () {
        JavascriptParser({
          returnReply: returnReply,
          returnError: true
        })
      }, function (err) {
        assert.strictEqual(err.message, 'The options argument contains the property "returnError" that is either unkown or of a wrong type')
        assert(err instanceof TypeError)
        return true
      })
    })

    it('should not fail for unknown options properties', function () {
      JavascriptParser({
        returnReply: returnReply,
        returnError: returnError,
        bla: 6
      })
    })
  })

  parsers.forEach(function (Parser) {
    function createBufferOfSize (parser, size, str) {
      if (size % 65536 !== 0) {
        throw new Error('Size may only be multiple of 65536')
      }
      str = str || ''
      var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
        'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
        'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
      var bigStringArray = (new Array(Math.pow(2, 16) / lorem.length).join(lorem + ' ')).split(' ') // Math.pow(2, 16) chars long
      var startBigBuffer = new Buffer(str + '$' + (size) + '\r\n')
      var parts = size / 65536
      var chunks = new Array(parts)
      parser.execute(startBigBuffer)
      for (var i = 0; i < parts; i++) {
        chunks[i] = new Buffer(bigStringArray.join(' ') + '.') // Math.pow(2, 16) chars long
        if (Parser.name === 'JavascriptRedisParser') {
          assert.strictEqual(parser.bufferCache.length, i + 1)
        }
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
      options.returnReply = options.returnReply || returnReply
      options.returnError = options.returnError || returnError
      options.returnFatalError = options.returnFatalError || returnFatalError
      return new Parser(options)
    }

    describe(Parser.name, function () {
      it('should not set the bufferOffset to a negative value', function (done) {
        if (Parser.name === 'HiredisReplyParser') {
          return this.skip()
        }
        var size = 64 * 1024
        function checkReply (reply) {}
        var parser = newParser(checkReply, 'buffer')
        createBufferOfSize(parser, size * 11)
        createBufferOfSize(parser, size, '\r\n')
        parser.execute(new Buffer('\r\n'))
        setTimeout(function () {
          done()
        }, 500)
      })

      it('multiple parsers do not interfere', function () {
        var replyCount = 0
        var results = [1234567890, 'foo bar baz', 'hello world']
        function checkReply (reply) {
          assert.strictEqual(results[replyCount], reply)
          replyCount++
        }
        var parserOne = newParser(checkReply)
        var parserTwo = newParser(checkReply)
        parserOne.execute(new Buffer('+foo '))
        parserOne.execute(new Buffer('bar '))
        assert.strictEqual(replyCount, 0)
        parserTwo.execute(new Buffer(':1234567890\r\n+hello '))
        assert.strictEqual(replyCount, 1)
        parserTwo.execute(new Buffer('wor'))
        parserOne.execute(new Buffer('baz\r\n'))
        assert.strictEqual(replyCount, 2)
        parserTwo.execute(new Buffer('ld\r\n'))
        assert.strictEqual(replyCount, 3)
      })

      it('multiple parsers do not interfere with bulk strings in arrays', function () {
        var replyCount = 0
        var results = [['foo', 'foo bar baz'], [1234567890, 'hello world', 'the end'], 'ttttttttttttttttttttttttttttttttttttttttttttttt']
        function checkReply (reply) {
          assert.deepEqual(results[replyCount], reply)
          replyCount++
        }
        var parserOne = newParser(checkReply)
        var parserTwo = newParser(checkReply)
        parserOne.execute(new Buffer('*2\r\n+foo\r\n$11\r\nfoo '))
        parserOne.execute(new Buffer('bar '))
        assert.strictEqual(replyCount, 0)
        parserTwo.execute(new Buffer('*3\r\n:1234567890\r\n$11\r\nhello '))
        assert.strictEqual(replyCount, 0)
        parserOne.execute(new Buffer('baz\r\n+ttttttttttttttttttttttttt'))
        assert.strictEqual(replyCount, 1)
        parserTwo.execute(new Buffer('wor'))
        parserTwo.execute(new Buffer('ld\r\n'))
        assert.strictEqual(replyCount, 1)
        parserTwo.execute(new Buffer('+the end\r\n'))
        assert.strictEqual(replyCount, 2)
        parserOne.execute(new Buffer('tttttttttttttttttttttt\r\n'))
      })

      it('weird things', function () {
        var replyCount = 0
        var results = [[], '', [0, null, '', 0, '', []], 9223372036854776, '☃', [1, 'OK', null]]
        function checkReply (reply) {
          assert.deepEqual(results[replyCount], reply)
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.execute(new Buffer('*0\r\n$0\r\n\r\n*6\r\n:\r\n$-1\r\n$0\r\n\r\n:-\r\n$'))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('\r\n\r\n*\r\n:9223372036854775\r\n$' + Buffer.byteLength('☃') + '\r\n☃\r\n'))
        assert.strictEqual(replyCount, 5)
        parser.execute(new Buffer('*3\r\n:1\r\n+OK\r\n$-1\r\n'))
        assert.strictEqual(replyCount, 6)
      })

      it('weird things 2', function () {
        var replyCount = 0
        var results = [null, 12345, [], null, 't']
        function checkReply (reply) {
          assert.deepEqual(results[replyCount], reply)
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.execute(new Buffer('$-5'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\r\n:12345\r\n*-\r\n*-1\r\n+t\r\n'))
      })

      it('returned buffers do not get mutated', function () {
        var replyCount = 0
        var results = [new Buffer('aaaaaaaaaa'), new Buffer('zzzzzzzzzz')]
        function checkReply (reply) {
          assert.deepEqual(results[replyCount], reply)
          results[replyCount] = reply
          replyCount++
        }
        var parser = newParser(checkReply, 'buffer')
        parser.execute(new Buffer('$10\r\naaaaa'))
        parser.execute(new Buffer('aaaaa\r\n'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('$10\r\nzzzzz'))
        parser.execute(new Buffer('zzzzz\r\n'))
        assert.strictEqual(replyCount, 2)
        var str = results[0].toString()
        for (var i = 0; i < str.length; i++) {
          assert.strictEqual(str.charAt(i), 'a')
        }
      })

      it('chunks getting to big for the bufferPool', function () {
        // This is a edge case. Chunks should not exceed Math.pow(2, 16) bytes
        var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
          'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
          'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
          'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
        var bigString = (new Array(Math.pow(2, 17) / lorem.length + 1).join(lorem)) // Math.pow(2, 17) chars long
        var replyCount = 0
        var sizes = [4, Math.pow(2, 17)]
        function checkReply (reply) {
          assert.strictEqual(sizes[replyCount], reply.length)
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.execute(new Buffer('+test'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\r\n+'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer(bigString))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\r\n'))
        assert.strictEqual(replyCount, 2)
      })

      it('handles multi-bulk reply and check context binding', function () {
        var replyCount = 0
        function Abc () {}
        Abc.prototype.checkReply = function (reply) {
          assert.strictEqual(typeof this.log, 'function')
          assert.deepEqual(reply, [['a']], 'Expecting multi-bulk reply of [["a"]]')
          replyCount++
        }
        Abc.prototype.log = console.log
        var test = new Abc()
        var parser = newParser({
          returnReply: function (reply) {
            test.checkReply(reply)
          }
        })

        parser.execute(new Buffer('*1\r\n*1\r\n$1\r\na\r\n'))
        assert.strictEqual(replyCount, 1)

        parser.execute(new Buffer('*1\r\n*1\r'))
        parser.execute(new Buffer('\n$1\r\na\r\n'))
        assert.strictEqual(replyCount, 2)

        parser.execute(new Buffer('*1\r\n*1\r\n'))
        parser.execute(new Buffer('$1\r\na\r\n'))

        assert.equal(replyCount, 3, 'check reply should have been called three times')
      })

      it('parser error', function () {
        var replyCount = 0
        function Abc () {}
        Abc.prototype.checkReply = function (err) {
          assert.strictEqual(typeof this.log, 'function')
          assert.strictEqual(err.message, 'Protocol error, got "a" as reply type byte')
          assert.strictEqual(err.name, 'ReplyError')
          assert(err instanceof ReplyError)
          assert(err instanceof Error)
          replyCount++
        }
        Abc.prototype.log = console.log
        var test = new Abc()
        var parser = newParser({
          returnFatalError: function (err) {
            test.checkReply(err)
          }
        })

        parser.execute(new Buffer('a*1\r*1\r$1`zasd\r\na'))
        assert.equal(replyCount, 1)
      })

      it('parser error resets the buffer', function () {
        var replyCount = 0
        var errCount = 0
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
        var parser = new Parser({
          returnReply: checkReply,
          returnError: checkError,
          returnFatalError: checkError,
          returnBuffers: true
        })

        // The chunk contains valid data after the protocol error
        parser.execute(new Buffer('*1\r\n+CCC\r\nb$1\r\nz\r\n+abc\r\n'))
        assert.strictEqual(replyCount, 1)
        assert.strictEqual(errCount, 1)
        parser.execute(new Buffer('*1\r\n+CCC\r\n'))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('-Protocol error, got "b" as reply type byte\r\n'))
        assert.strictEqual(errCount, 2)
      })

      it('parser error v3 without returnFatalError specified', function () {
        var replyCount = 0
        var errCount = 0
        function checkReply (reply) {
          assert.strictEqual(reply[0], 'OK')
          replyCount++
        }
        function checkError (err) {
          assert.strictEqual(err.message, 'Protocol error, got "\\n" as reply type byte')
          errCount++
        }
        var parser = new Parser({
          returnReply: checkReply,
          returnError: checkError
        })

        parser.execute(new Buffer('*1\r\n+OK\r\n\n+zasd\r\n'))
        assert.strictEqual(replyCount, 1)
        assert.strictEqual(errCount, 1)
      })

      it('should handle \\r and \\n characters properly', function () {
        // If a string contains \r or \n characters it will always be send as a bulk string
        var replyCount = 0
        var entries = ['foo\r', 'foo\r\nbar', '\r\nСанкт-Пет', 'foo\r\n', 'foo', 'foobar', 'foo\r', 'äfooöü', 'abc']
        function checkReply (reply) {
          assert.strictEqual(reply, entries[replyCount])
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer('$4\r\nfoo\r\r\n$8\r\nfoo\r\nbar\r\n$19\r\n\r\n'))
        parser.execute(new Buffer([208, 161, 208, 176, 208, 189, 208]))
        parser.execute(new Buffer([186, 209, 130, 45, 208, 159, 208, 181, 209, 130]))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('\r\n$5\r\nfoo\r\n\r\n'))
        assert.strictEqual(replyCount, 4)
        parser.execute(new Buffer('+foo\r'))
        assert.strictEqual(replyCount, 4)
        parser.execute(new Buffer('\n$6\r\nfoobar\r'))
        assert.strictEqual(replyCount, 5)
        parser.execute(new Buffer('\n$4\r\nfoo\r\r\n'))
        assert.strictEqual(replyCount, 7)
        parser.execute(new Buffer('$9\r\näfo'))
        parser.execute(new Buffer('oö'))
        parser.execute(new Buffer('ü\r'))
        assert.strictEqual(replyCount, 7)
        parser.execute(new Buffer('\n+abc\r\n'))
        assert.strictEqual(replyCount, 9)
      })

      it('line breaks in the beginning of the last chunk', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.deepEqual(reply, [['a']], 'Expecting multi-bulk reply of [["a"]]')
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer('*1\r\n*1\r\n$1\r\na'))
        assert.equal(replyCount, 0)

        parser.execute(new Buffer('\r\n*1\r\n*1\r'))
        assert.equal(replyCount, 1)
        parser.execute(new Buffer('\n$1\r\na\r\n*1\r\n*1\r\n$1\r\na\r\n'))

        assert.equal(replyCount, 3, 'check reply should have been called three times')
      })

      it('multiple chunks in a bulk string', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.strictEqual(reply, 'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij')
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer('$100\r\nabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\r\n'))
        assert.strictEqual(replyCount, 1)

        parser.execute(new Buffer('$100\r'))
        parser.execute(new Buffer('\nabcdefghijabcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghij'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer(
          'abcdefghij\r\n' +
          '$100\r\nabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij\r\n' +
          '$100\r\nabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij'
        ))
        assert.strictEqual(replyCount, 3)
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij\r'))
        assert.strictEqual(replyCount, 3)
        parser.execute(new Buffer('\n'))

        assert.equal(replyCount, 4, 'check reply should have been called three times')
      })

      it('multiple chunks with arrays different types', function () {
        var replyCount = 0
        var predefinedData = [
          'abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij',
          'test',
          100,
          new ReplyError('Error message'),
          ['The force awakens'],
          new ReplyError()
        ]
        function checkReply (reply) {
          for (var i = 0; i < reply.length; i++) {
            if (Array.isArray(reply[i])) {
              reply[i].forEach(function (reply, j) {
                assert.strictEqual(reply, predefinedData[i][j])
              })
            } else if (reply[i] instanceof Error) {
              if (Parser.name !== 'HiredisReplyParser') { // The hiredis always returns normal errors in case of nested ones
                assert(reply[i] instanceof ReplyError)
                assert.strictEqual(reply[i].name, predefinedData[i].name)
              }
              assert.strictEqual(reply[i].message, predefinedData[i].message)
            } else {
              assert.strictEqual(reply[i], predefinedData[i])
            }
          }
          replyCount++
        }
        var parser = newParser({
          returnReply: checkReply,
          returnBuffers: false
        })

        parser.execute(new Buffer('*6\r\n$100\r\nabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij'))
        parser.execute(new Buffer('abcdefghijabcdefghijabcdefghij\r\n'))
        parser.execute(new Buffer('+test\r'))
        parser.execute(new Buffer('\n:100'))
        parser.execute(new Buffer('\r\n-Error message'))
        parser.execute(new Buffer('\r\n*1\r\n$17\r\nThe force'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer(' awakens\r\n-\r\n$5'))
        assert.strictEqual(replyCount, 1)
      })

      it('return normal errors', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.equal(reply.message, 'Error message')
          replyCount++
        }
        var parser = newParser({
          returnError: checkReply
        })

        parser.execute(new Buffer('-Error '))
        parser.execute(new Buffer('message\r\n*3\r\n$17\r\nThe force'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer(' awakens\r\n$5'))
        assert.strictEqual(replyCount, 1)
      })

      it('return null for empty arrays and empty bulk strings', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.equal(reply, null)
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer('$-1\r\n*-'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('1'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\r\n$-'))
        assert.strictEqual(replyCount, 2)
      })

      it('return value even if all chunks are only 1 character long', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.equal(reply, 1)
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer(':'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('1'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\r'))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\n'))
        assert.strictEqual(replyCount, 1)
      })

      it('do not return before \\r\\n', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.equal(reply, 1)
          replyCount++
        }
        var parser = newParser(checkReply)

        parser.execute(new Buffer(':1\r\n:'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('1'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\r'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\n'))
        assert.strictEqual(replyCount, 2)
      })

      it('return data as buffer if requested', function () {
        var replyCount = 0
        function checkReply (reply) {
          if (Array.isArray(reply)) {
            reply = reply[0]
          }
          assert(Buffer.isBuffer(reply))
          assert.strictEqual(reply.inspect(), new Buffer('test').inspect())
          replyCount++
        }
        var parser = newParser(checkReply, 'buffer')

        parser.execute(new Buffer('+test\r\n'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('$4\r\ntest\r\n'))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('*1\r\n$4\r\ntest\r\n'))
        assert.strictEqual(replyCount, 3)
      })

      it('handle special case buffer sizes properly', function () {
        var replyCount = 0
        var entries = ['test test ', 'test test test test ', 1234]
        function checkReply (reply) {
          assert.strictEqual(reply, entries[replyCount])
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.execute(new Buffer('$10\r\ntest '))
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('test \r\n$20\r\ntest test test test \r\n:1234\r'))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('\n'))
        assert.strictEqual(replyCount, 3)
      })

      it('return numbers as strings', function () {
        if (Parser.name === 'HiredisReplyParser') {
          return this.skip()
        }
        var replyCount = 0
        var entries = ['123', '590295810358705700002', '-99999999999999999', '4294967290', '90071992547409920', '10000040000000000000000000000000000000020']
        function checkReply (reply) {
          assert.strictEqual(typeof reply, 'string')
          assert.strictEqual(reply, entries[replyCount])
          replyCount++
        }
        var parser = newParser({
          returnReply: checkReply,
          stringNumbers: true
        })
        parser.execute(new Buffer(':123\r\n:590295810358705700002\r\n:-99999999999999999\r\n:4294967290\r\n:90071992547409920\r\n:10000040000000000000000000000000000000020\r\n'))
        assert.strictEqual(replyCount, 6)
      })

      it('handle big numbers', function () {
        var replyCount = 0
        var number = 9007199254740991 // Number.MAX_SAFE_INTEGER
        function checkReply (reply) {
          assert.strictEqual(reply, number++)
          replyCount++
        }
        var parser = newParser(checkReply)
        parser.execute(new Buffer(':' + number + '\r\n'))
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer(':' + number + '\r\n'))
        assert.strictEqual(replyCount, 2)
      })

      it('handle big data with buffers', function (done) {
        var chunks
        var replyCount = 0
        var replies = []
        var jsParser = Parser.name === 'JavascriptRedisParser'
        function checkReply (reply) {
          replies.push(reply)
          replyCount++
        }
        var parser = newParser(checkReply, 'buffer')
        parser.execute(new Buffer('+test'))
        assert.strictEqual(replyCount, 0)
        createBufferOfSize(parser, 128 * 1024, '\r\n')
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\r\n'))
        assert.strictEqual(replyCount, 2)
        setTimeout(function () {
          parser.execute(new Buffer('+test'))
          assert.strictEqual(replyCount, 2)
          chunks = createBufferOfSize(parser, 256 * 1024, '\r\n')
          assert.strictEqual(replyCount, 3)
          parser.execute(new Buffer('\r\n'))
          assert.strictEqual(replyCount, 4)
        }, 25)
        // Delay done so the bufferPool is cleared and tested
        // If the buffer is not cleared, the coverage is not going to be at 100
        setTimeout(function () {
          var totalBuffer = Buffer.concat(chunks).toString()
          assert.strictEqual(replies[3].toString(), totalBuffer)
          done()
        }, (jsParser ? 1400 : 50))
      })

      it('handle big data', function () {
        var replyCount = 0
        function checkReply (reply) {
          assert.strictEqual(reply.length, 4 * 1024 * 1024)
          replyCount++
        }
        var parser = newParser(checkReply)
        createBufferOfSize(parser, 4 * 1024 * 1024)
        assert.strictEqual(replyCount, 0)
        parser.execute(new Buffer('\r\n'))
        assert.strictEqual(replyCount, 1)
      })

      it('handle big data 2 with buffers', function (done) {
        this.timeout(7500)
        var replyCount = 0
        var size = 120 * 1024 * 1024
        var replyLen = [size, size * 2, 11, 11]
        function checkReply (reply) {
          assert.strictEqual(reply.length, replyLen[replyCount])
          replyCount++
        }
        var parser = newParser(checkReply, 'buffer')
        createBufferOfSize(parser, size)
        assert.strictEqual(replyCount, 0)
        createBufferOfSize(parser, size * 2, '\r\n')
        assert.strictEqual(replyCount, 1)
        parser.execute(new Buffer('\r\n+hello world'))
        assert.strictEqual(replyCount, 2)
        parser.execute(new Buffer('\r\n$11\r\nhuge'))
        setTimeout(function () {
          parser.execute(new Buffer(' buffer\r\n'))
          assert.strictEqual(replyCount, 4)
          done()
        }, 75)
      })
    })
  })
})
