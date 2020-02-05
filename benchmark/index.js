'use strict'

/* eslint handle-callback-err: 0 */

const Benchmark = require('benchmark')
const suite = new Benchmark.Suite()
const Parser = require('./../')
const Buffer = require('buffer').Buffer

function returnError (error) {}
function checkReply (error, res) {}

const startBuffer = Buffer.from('$100\r\nabcdefghij')
const chunkBuffer = Buffer.from('abcdefghijabcdefghijabcdefghij')
const stringBuffer = Buffer.from('+testing a simple string\r\n')
const integerBuffer = Buffer.from(':1237884\r\n')
const bigIntegerBuffer = Buffer.from(':184467440737095516171234567890\r\n') // 2^64 + 1
const errorBuffer = Buffer.from('-Error ohnoesitbroke\r\n')
const endBuffer = Buffer.from('\r\n')
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, ' +
  'sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ' +
  'ut aliquip ex ea commodo consequat. Duis aute irure dolor in' // 256 chars
const bigStringArray = (new Array(Math.pow(2, 16) / lorem.length).join(lorem + ' ')).split(' ') // Math.pow(2, 16) chars long
const startBigBuffer = Buffer.from('$' + (4 * 1024 * 1024) + '\r\n')

const chunks = new Array(64)
for (var i = 0; i < 64; i++) {
  chunks[i] = Buffer.from(bigStringArray.join(' ') + '.') // Math.pow(2, 16) chars long
}

const arraySize = 100
var array = '*' + arraySize + '\r\n'
var size = 0
for (i = 0; i < arraySize; i++) {
  array += '$'
  size = (Math.random() * 10 | 0) + 1
  array += size + '\r\n' + lorem.slice(0, size) + '\r\n'
}

const arrayBuffer = Buffer.from(array)

const bigArraySize = 160
const bigArrayChunks = [Buffer.from('*1\r\n*1\r\n*' + bigArraySize)]
for (i = 0; i < bigArraySize; i++) {
  // A chunk has a maximum size of 2^16 bytes.
  size = 65000 + i
  if (i % 2) {
    // The "x" in the beginning is important to prevent benchmark manipulation due to a minor JSParser optimization
    bigArrayChunks.push(Buffer.from('x\r\n$' + size + '\r\n' + Array(size + 1).join('a') + '\r\n:' + (Math.random() * 1000000 | 0)))
  } else {
    bigArrayChunks.push(Buffer.from('\r\n+this is some short text about nothing\r\n:' + size + '\r\n$' + size + '\r\n' + Array(size).join('b')))
  }
}
bigArrayChunks.push(Buffer.from('\r\n'))

const chunkedStringPart1 = Buffer.from('+foobar')
const chunkedStringPart2 = Buffer.from('bazEND\r\n')

const options = {
  returnReply: checkReply,
  returnError: returnError,
  returnFatalError: returnError
}
const parser = new Parser(options)

options.returnBuffers = true
const parserBuffer = new Parser(options)

options.stringNumbers = true
const parserStr = new Parser(options)

delete options.stringNumbers
options.bigInt = true
const parserBigInt = new Parser(options)

const runBigInt = process.argv.length === 2 || process.argv.includes('bigint')

// BULK STRINGS

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

suite.add('JS PARSER: + multiple chunks in a string', function () {
  parser.execute(chunkedStringPart1)
  parser.execute(chunkedStringPart2)
})

suite.add('JS PARSER BUF: + multiple chunks in a string', function () {
  parserBuffer.execute(chunkedStringPart1)
  parserBuffer.execute(chunkedStringPart2)
})

// BIG BULK STRING

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

suite.add('JS PARSER: + simple string', function () {
  parser.execute(stringBuffer)
})

suite.add('JS PARSER BUF: + simple string', function () {
  parserBuffer.execute(stringBuffer)
})

// INTEGERS

suite.add('JS PARSER: : integer', function () {
  parser.execute(integerBuffer)
})

suite.add('JS PARSER STR: : integer', function () {
  parserStr.execute(integerBuffer)
})

if (runBigInt) {
  suite.add('JS PARSER BIGINT: : integer', function () {
    parserBigInt.execute(integerBuffer)
  })
}

// BIG INTEGER

suite.add('JS PARSER: : big integer', function () {
  parser.execute(bigIntegerBuffer)
})

suite.add('JS PARSER STR: : big integer', function () {
  parserStr.execute(bigIntegerBuffer)
})

if (runBigInt) {
  suite.add('JS PARSER BIGINT: : big integer', function () {
    parserBigInt.execute(bigIntegerBuffer)
  })
}

// ARRAYS

suite.add('JS PARSER: * array', function () {
  parser.execute(arrayBuffer)
})

suite.add('JS PARSER BUF: * array', function () {
  parserBuffer.execute(arrayBuffer)
})

// BIG NESTED ARRAYS

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
