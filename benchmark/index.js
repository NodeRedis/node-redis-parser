var Benchmark = require('benchmark');
var assert = require('assert');
var suite = new Benchmark.Suite;

var Parser = require('./../lib/parser');
var ParserOLD = require('./old/parser');

function returnError(error) {
	// throw error; silent for err error perf test
}

function checkReply() {
}

var startBuffer = new Buffer('$100\r\nabcdefghij');
var chunkBuffer = new Buffer('abcdefghijabcdefghijabcdefghij');
var stringBuffer = new Buffer('+testing a simple string\r\n');
var integerBuffer = new Buffer(':1237884\r\n');
var errorBuffer = new Buffer('-Error ohnoesitbroke\r\n');
var arrayBuffer = new Buffer('*1\r\n*1\r\n$1\r\na\r\n');
var endBuffer = new Buffer('\r\n');

var parserOld = new ParserOLD({
	returnReply: checkReply,
	returnError: returnError,
	returnFatalError: returnError,
	name: 'javascript'
});

var parserHiRedis = new Parser({
	returnReply: checkReply,
	returnError: returnError,
	returnFatalError: returnError,
	name: 'hiredis'
});

var parser = new Parser({
	returnReply: checkReply,
	returnError: returnError,
	returnFatalError: returnError,
	name: 'javascript'
});

// BULK STRINGS

suite.add('OLD CODE: multiple chunks in a bulk string', function () {
	parserOld.execute(startBuffer);
	parserOld.execute(chunkBuffer);
	parserOld.execute(chunkBuffer);
	parserOld.execute(chunkBuffer);
	parserOld.execute(endBuffer);
});

suite.add('HIREDIS: multiple chunks in a bulk string', function () {
	parserHiRedis.execute(startBuffer);
	parserHiRedis.execute(chunkBuffer);
	parserHiRedis.execute(chunkBuffer);
	parserHiRedis.execute(chunkBuffer);
	parserHiRedis.execute(endBuffer);
});

suite.add('NEW CODE: multiple chunks in a bulk string', function () {
	parser.execute(startBuffer);
	parser.execute(chunkBuffer);
	parser.execute(chunkBuffer);
	parser.execute(chunkBuffer);
	parser.execute(endBuffer);
});

// STRINGS

suite.add('\nOLD CODE: + simple string', function () {
	parserOld.execute(stringBuffer);
});

suite.add('HIREDIS: + simple string', function () {
	parserHiRedis.execute(stringBuffer);
});

suite.add('NEW CODE: + simple string', function () {
	parser.execute(stringBuffer);
});

// INTEGERS

suite.add('\nOLD CODE: + integer', function () {
	parserOld.execute(integerBuffer);
});

suite.add('HIREDIS: + integer', function () {
	parserHiRedis.execute(integerBuffer);
});

suite.add('NEW CODE: + integer', function () {
	parser.execute(integerBuffer);
});

// ARRAYS

suite.add('\nOLD CODE: * array', function () {
	parserOld.execute(arrayBuffer);
});

suite.add('HIREDIS: * array', function () {
	parserHiRedis.execute(arrayBuffer);
});

suite.add('NEW CODE: * array', function () {
	parser.execute(arrayBuffer);
});


// ERRORS

suite.add('\nOLD CODE: * error', function () {
	parserOld.execute(errorBuffer);
});

suite.add('HIREDIS: * error', function () {
	parserHiRedis.execute(errorBuffer);
});

suite.add('NEW CODE: * error', function () {
	parser.execute(errorBuffer);
});


// add listeners
suite.on('cycle', function (event) {
	console.log(String(event.target));
});

suite.on('complete', function () {
	console.log('\n\nFastest is ' + this.filter('fastest').map('name'));
});


suite.run({delay:2, minSamples: 100 });