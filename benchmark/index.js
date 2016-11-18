var Benchmark = require('benchmark')
var suite = new Benchmark.Suite()

var Parser = require('./../')
var ParserOLD = require('./old/parser')

function returnError (error) {
  error = null
}

function checkReply () {}

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

var bigArraySize = 1000
var bigArrayChunks = [new Buffer('*' + bigArraySize)]
for (i = 0; i < bigArraySize; i++) {
  size = (Math.random() * 10000 | 0)
  if (i % 2) {
    bigArrayChunks.push(new Buffer('\r\n$' + size + '\r\n' + Array(size + 1).join('a')))
  } else {
    bigArrayChunks.push(new Buffer('\r\n+' + Array(size + 1).join('b')))
  }
}
bigArrayChunks.push(new Buffer('\r\n'))

var chunkedStringPart1 = new Buffer('+foobar')
var chunkedStringPart2 = new Buffer('bazEND\r\n')

var parserOld = new ParserOLD({
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError,
  name: 'javascript'
})

var parserHiRedis = new Parser({
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError,
  name: 'hiredis'
})

var parser = new Parser({
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError
})

var parserBuffer = new Parser({
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError,
  returnBuffers: true
})

var parserStr = new Parser({
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError,
  stringNumbers: true
})

// BULK STRINGS

suite.add('OLD CODE: multiple chunks in a bulk string', function () {
  parserOld.execute(startBuffer)
  parserOld.execute(chunkBuffer)
  parserOld.execute(chunkBuffer)
  parserOld.execute(chunkBuffer)
  parserOld.execute(endBuffer)
})

suite.add('HIREDIS: multiple chunks in a bulk string', function () {
  parserHiRedis.execute(startBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(chunkBuffer)
  parserHiRedis.execute(endBuffer)
})

suite.add('NEW CODE: multiple chunks in a bulk string', function () {
  parser.execute(startBuffer)
  parser.execute(chunkBuffer)
  parser.execute(chunkBuffer)
  parser.execute(chunkBuffer)
  parser.execute(endBuffer)
})

suite.add('NEW BUF: multiple chunks in a bulk string', function () {
  parserBuffer.execute(startBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(chunkBuffer)
  parserBuffer.execute(endBuffer)
})

// CHUNKED STRINGS

suite.add('\nOLD CODE: multiple chunks in a string', function () {
  parserOld.execute(chunkedStringPart1)
  parserOld.execute(chunkedStringPart2)
})

suite.add('HIREDIS: multiple chunks in a string', function () {
  parserHiRedis.execute(chunkedStringPart1)
  parserHiRedis.execute(chunkedStringPart2)
})

suite.add('NEW CODE: multiple chunks in a string', function () {
  parser.execute(chunkedStringPart1)
  parser.execute(chunkedStringPart2)
})

suite.add('NEW BUF: multiple chunks in a string', function () {
  parserBuffer.execute(chunkedStringPart1)
  parserBuffer.execute(chunkedStringPart2)
})

// BIG BULK STRING

suite.add('\nOLD CODE: 4mb bulk string', function () {
  parserOld.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserOld.execute(chunks[i])
  }
  parserOld.execute(endBuffer)
})

suite.add('HIREDIS: 4mb bulk string', function () {
  parserHiRedis.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserHiRedis.execute(chunks[i])
  }
  parserHiRedis.execute(endBuffer)
})

suite.add('NEW CODE: 4mb bulk string', function () {
  parser.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parser.execute(chunks[i])
  }
  parser.execute(endBuffer)
})

suite.add('NEW BUF: 4mb bulk string', function () {
  parserBuffer.execute(startBigBuffer)
  for (var i = 0; i < 64; i++) {
    parserBuffer.execute(chunks[i])
  }
  parserBuffer.execute(endBuffer)
})

// STRINGS

suite.add('\nOLD CODE: + simple string', function () {
  parserOld.execute(stringBuffer)
})

suite.add('HIREDIS: + simple string', function () {
  parserHiRedis.execute(stringBuffer)
})

suite.add('NEW CODE: + simple string', function () {
  parser.execute(stringBuffer)
})

suite.add('NEW BUF: + simple string', function () {
  parserBuffer.execute(stringBuffer)
})

// INTEGERS

suite.add('\nOLD CODE: + integer', function () {
  parserOld.execute(integerBuffer)
})

suite.add('HIREDIS: + integer', function () {
  parserHiRedis.execute(integerBuffer)
})

suite.add('NEW CODE: + integer', function () {
  parser.execute(integerBuffer)
})

suite.add('NEW STR: + integer', function () {
  parserStr.execute(integerBuffer)
})

// BIG INTEGER

suite.add('\nOLD CODE: + big integer', function () {
  parserOld.execute(bigIntegerBuffer)
})

suite.add('HIREDIS: + big integer', function () {
  parserHiRedis.execute(bigIntegerBuffer)
})

suite.add('NEW CODE: + big integer', function () {
  parser.execute(bigIntegerBuffer)
})

suite.add('NEW STR: + big integer', function () {
  parserStr.execute(bigIntegerBuffer)
})

// ARRAYS

suite.add('\nOLD CODE: * array', function () {
  parserOld.execute(arrayBuffer)
})

suite.add('HIREDIS: * array', function () {
  parserHiRedis.execute(arrayBuffer)
})

suite.add('NEW CODE: * array', function () {
  parser.execute(arrayBuffer)
})

suite.add('NEW BUF: * array', function () {
  parserBuffer.execute(arrayBuffer)
})

// BIG ARRAYS (running the old parser is to slow)

suite.add('HIREDIS: * bigArray', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parserHiRedis.execute(bigArrayChunks[i])
  }
})

suite.add('NEW CODE: * bigArray', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parser.execute(bigArrayChunks[i])
  }
})

suite.add('NEW BUF: * bigArray', function () {
  for (var i = 0; i < bigArrayChunks.length; i++) {
    parserBuffer.execute(bigArrayChunks[i])
  }
})

// ERRORS

suite.add('\nOLD CODE: * error', function () {
  parserOld.execute(errorBuffer)
})

suite.add('HIREDIS: * error', function () {
  parserHiRedis.execute(errorBuffer)
})

suite.add('NEW CODE: * error', function () {
  parser.execute(errorBuffer)
})

// add listeners
suite.on('cycle', function (event) {
  console.log(String(event.target))
})

suite.on('complete', function () {
  console.log('\n\nFastest is ' + this.filter('fastest').map('name'))
})

suite.run({ delay: 1, minSamples: 150 })
