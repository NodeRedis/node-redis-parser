'use strict'

/* eslint handle-callback-err: 0 */

var intercept = require('intercept-stdout')
var Benchmark = require('benchmark')
var suite = new Benchmark.Suite()
var Parser = require('./../')

function returnError (error) {}
function checkReply (error, res) {}
function shuffle (array) {
  var currentIndex = array.length
  var temporaryValue
  var randomIndex

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex -= 1

    // And swap it with the current element.
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }

  return array
}

// Suppress hiredis warnings
intercept(function () {}, function () { return '' })

var startBuffer = new Buffer('$100\r\nabcdefghij')
var chunkBuffer = new Buffer('abcdefghijabcdefghijabcdefghij')
var stringBuffer = new Buffer('+testing a simple string\r\n')
var integerBuffer = new Buffer(':1237884\r\n')
var bigIntegerBuffer = new Buffer(':184467440737095516171234567890\r\n') // 2^64 + 1
var errorBuffer = new Buffer('-Error ohnoesitbroke\r\n')
var endBuffer = new Buffer('\r\n')
var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
  'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
  'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
var bigStringArray = (new Array(Math.pow(2, 16) / lorem.length).join(lorem + ' ')).split(' ') // Math.pow(2, 16) chars long
var startBigBuffer = new Buffer('$' + (4 * 1024 * 1024) + '\r\n')

var chunks = new Array(64)
for (var i = 0; i < 64; i++) {
  chunks[i] = new Buffer(shuffle(bigStringArray).join(' ') + '.') // Math.pow(2, 16) chars long
}

var arraySize = 100
var array = '*' + arraySize + '\r\n'
var size = 0
for (i = 0; i < arraySize; i++) {
  array += '$'
  size = (Math.random() * 10 | 0) + 1
  array += size + '\r\n' + lorem.slice(0, size) + '\r\n'
}

var arrayBuffer = new Buffer(array)

var bigArraySize = 160
var bigArrayChunks = [new Buffer('*1\r\n*1\r\n*' + bigArraySize)]
for (i = 0; i < bigArraySize; i++) {
  // A chunk has a maximum size of 2^16 bytes.
  size = 65000 + i
  if (i % 2) {
    bigArrayChunks.push(new Buffer('\r\n$' + size + '\r\n' + Array(size + 1).join('a') + '\r\n:' + (Math.random() * 1000000 | 0)))
  } else {
    bigArrayChunks.push(new Buffer('\r\n+this is some short text about nothing\r\n:' + size + '\r\n$' + size + '\r\n' + Array(size + 1).join('b')))
  }
}
bigArrayChunks.push(new Buffer('\r\n'))

var chunkedStringPart1 = new Buffer('+foobar')
var chunkedStringPart2 = new Buffer('bazEND\r\n')

var options = {
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError
}
var parser = new Parser(options)

options.returnBuffers = true
var parserBuffer = new Parser(options)

options.name = 'hiredis'
var parserHiRedisBuffer = new Parser(options)

delete options.returnBuffers
var parserHiRedis = new Parser(options)

delete options.name
options.stringNumbers = true
var parserStr = new Parser(options)

// BULK STRINGS

suite.add('HIREDIS: $ multiple chunks in a bulk string', function () {
  parserHiRedis.execute(startBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(endBuffer)
})

suite.add('HIREDIS BUF: $ multiple chunks in a bulk string', function () {
  parserHiRedisBuffer.execute(startBuffer)
  parserHiRedisBuffer.execute(chunkBuffer)
  parserHiRedisBuffer.execute(chunkBuffer)
  parserHiRedisBuffer.execute(chunkBuffer)
  parserHiRedisBuffer.execute(endBuffer)
})

suite.add('JS PARSER: $ multiple chunks in a bulk string', function () {
  parser.execute(startBuffer)
  parser.execute(chunkBuffer)
  parser.execute(chunkBuffer)
  parser.execute(chunkBuffer)
  parser.execute(endBuffer)
})

suite.add('JS PARSER BUF: $ multiple chunks in a bulk string', function () {
  parserBuffer.execute(startBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(endBuffer)
})

// CHUNKED STRINGS

suite.add('\nHIREDIS: + multiple chunks in a string', function () {
  parserHiRedis.execute(chunkedStringPart1)
  parserHiRedis.execute(chunkedStringPart2)
})

suite.add('HIREDIS BUF: + multiple chunks in a string', function () {
  parserHiRedisBuffer.execute(chunkedStringPart1)
  parserHiRedisBuffer.execute(chunkedStringPart2)
})

suite.add('JS PARSER: + multiple chunks in a string', function () {
  parser.execute(chunkedStringPart1)
  parser.execute(chunkedStringPart2)
})

suite.add('JS PARSER BUF: + multiple chunks in a string', function () {
  parserBuffer.execute(chunkedStringPart1)
  parserBuffer.execute(chunkedStringPart2)
})

// BIG BULK STRING

suite.add('\nHIREDIS: $ 4mb bulk string', function () {
  parserHiRedis.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserHiRedis.execute(chunks[i])
  }
  parserHiRedis.execute(endBuffer)
})

suite.add('HIREDIS BUF: $ 4mb bulk string', function () {
  parserHiRedisBuffer.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserHiRedisBuffer.execute(chunks[i])
  }
  parserHiRedisBuffer.execute(endBuffer)
})

suite.add('JS PARSER: $ 4mb bulk string', function () {
  parser.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parser.execute(chunks[i])
  }
  parser.execute(endBuffer)
})

suite.add('JS PARSER BUF: $ 4mb bulk string', function () {
  parserBuffer.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserBuffer.execute(chunks[i])
  }
  parserBuffer.execute(endBuffer)
})

// STRINGS

suite.add('\nHIREDIS: + simple string', function () {
  parserHiRedis.execute(stringBuffer)
})

suite.add('HIREDIS BUF: + simple string', function () {
  parserHiRedisBuffer.execute(stringBuffer)
})

suite.add('JS PARSER: + simple string', function () {
  parser.execute(stringBuffer)
})

suite.add('JS PARSER BUF: + simple string', function () {
  parserBuffer.execute(stringBuffer)
})

// INTEGERS

suite.add('\nHIREDIS: : integer', function () {
  parserHiRedis.execute(integerBuffer)
})

suite.add('JS PARSER: : integer', function () {
  parser.execute(integerBuffer)
})

suite.add('JS PARSER STR: : integer', function () {
  parserStr.execute(integerBuffer)
})

// BIG INTEGER

suite.add('\nHIREDIS: : big integer', function () {
  parserHiRedis.execute(bigIntegerBuffer)
})

suite.add('JS PARSER: : big integer', function () {
  parser.execute(bigIntegerBuffer)
})

suite.add('JS PARSER STR: : big integer', function () {
  parserStr.execute(bigIntegerBuffer)
})

// ARRAYS

suite.add('\nHIREDIS: * array', function () {
  parserHiRedis.execute(arrayBuffer)
})

suite.add('HIREDIS BUF: * array', function () {
  parserHiRedisBuffer.execute(arrayBuffer)
})

suite.add('JS PARSER: * array', function () {
  parser.execute(arrayBuffer)
})

suite.add('JS PARSER BUF: * array', function () {
  parserBuffer.execute(arrayBuffer)
})

// BIG NESTED ARRAYS

suite.add('\nHIREDIS: * big nested array', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parserHiRedis.execute(bigArrayChunks[i])
  }
})

suite.add('HIREDIS BUF: * big nested array', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parserHiRedisBuffer.execute(bigArrayChunks[i])
  }
})

suite.add('JS PARSER: * big nested array', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parser.execute(bigArrayChunks[i])
  }
})

suite.add('JS PARSER BUF: * big nested array', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parserBuffer.execute(bigArrayChunks[i])
  }
})

// ERRORS

suite.add('\nHIREDIS: - error', function () {
  parserHiRedis.execute(errorBuffer)
})

suite.add('JS PARSER: - error', function () {
  parser.execute(errorBuffer)
})

// add listeners
suite.on('cycle', function (event) {
  console.log(String(event.target))
})

suite.on('complete', function () {
  console.log('\n\nFastest is ' + this.filter('fastest').map('name'))
  // Do not wait for the bufferPool to shrink
  process.exit()
})

suite.run({ delay: 1, minSamples: 150 })
