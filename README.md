[![Build Status](https://travis-ci.org/NodeRedis/node-redis-parser.png?branch=master)](https://travis-ci.org/NodeRedis/node-redis-parser)
[![Test Coverage](https://codeclimate.com/github/NodeRedis/node-redis-parser/badges/coverage.svg)](https://codeclimate.com/github/NodeRedis/node-redis-parser/coverage)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](http://standardjs.com/)

# redis-parser

A high performance javascript redis parser built for [node_redis](https://github.com/NodeRedis/node_redis) and [ioredis](https://github.com/luin/ioredis). Parses all [RESP](http://redis.io/topics/protocol) data.

## Install

Install with [NPM](https://npmjs.org/):

    npm install redis-parser

## Usage

```js
const Parser = require('redis-parser');

const myParser = new Parser(options);
```

### Options

* `returnReply`: *function*; mandatory
* `returnError`: *function*; mandatory
* `returnFatalError`: *function*; optional, defaults to the returnError function
* `returnBuffers`: *boolean*; optional, defaults to false
* `stringNumbers`: *boolean*; optional, defaults to false

### Functions

* `reset()`: reset the parser to it's initial state
* `setReturnBuffers(boolean)`: set the returnBuffers option on/off without resetting the parser
* `setStringNumbers(boolean)`: set the stringNumbers option on/off without resetting the parser

### Error classes

* `RedisError` sub class of Error
* `ReplyError` sub class of RedisError
* `ParserError` sub class of RedisError

All Redis errors will be returned as `ReplyErrors` while a parser error is returned as `ParserError`.  
All error classes can be imported by the npm `redis-errors` package.

### Example

```js
const Parser = require("redis-parser");

class Library {
  returnReply(reply) { /* ... */ }
  returnError(err) { /* ... */ }
  returnFatalError(err) { /* ... */ }

  streamHandler() {
    this.stream.on('data', (buffer) => {
      // Here the data (e.g. `Buffer.from('$5\r\nHello\r\n'`))
      // is passed to the parser and the result is passed to
      // either function depending on the provided data.
      parser.execute(buffer);
    });
  }
}

const lib = new Library();

const parser = new Parser({
  returnReply(reply) {
    lib.returnReply(reply);
  },
  returnError(err) {
    lib.returnError(err);
  },
  returnFatalError(err) {
    lib.returnFatalError(err);
  }
});
```

You do not have to use the returnFatalError function. Fatal errors will be returned in the normal error function in that case.

And if you want to return buffers instead of strings, you can do this by adding the `returnBuffers` option.

If you handle with big numbers that are to large for JS (Number.MAX_SAFE_INTEGER === 2^53 - 16) please use the `stringNumbers` option. That way all numbers are going to be returned as String and you can handle them safely.

```js
// Same functions as in the first example

const parser = new Parser({
  returnReply(reply) {
    lib.returnReply(reply);
  },
  returnError(err) {
    lib.returnError(err);
  },
  returnBuffers: true, // All strings are returned as Buffer e.g. <Buffer 48 65 6c 6c 6f>
  stringNumbers: true // All numbers are returned as String
});

// The streamHandler as above
```

## Protocol errors

To handle protocol errors (this is very unlikely to happen) gracefully you should add the returnFatalError option, reject any still running command (they might have been processed properly but the reply is just wrong), destroy the socket and reconnect. Note that while doing this no new command may be added, so all new commands have to be buffered in the meantime, otherwise a chunk might still contain partial data of a following command that was already processed properly but answered in the same chunk as the command that resulted in the protocol error.

## Contribute

The parser is highly optimized but there may still be further optimizations possible.

    npm install
    npm test
    npm run benchmark

Currently the benchmark compares the performance against the hiredis parser:

    HIREDIS:   $ multiple chunks in a bulk string x 1,169,386 ops/sec ±1.24% (92 runs sampled)
    JS PARSER: $ multiple chunks in a bulk string x 1,354,290 ops/sec ±1.69% (88 runs sampled)
    HIREDIS BUF:   $ multiple chunks in a bulk string x 633,639 ops/sec ±2.64% (84 runs sampled)
    JS PARSER BUF: $ multiple chunks in a bulk string x 1,783,922 ops/sec ±0.47% (94 runs sampled)

    HIREDIS:   + multiple chunks in a string x 2,394,900 ops/sec ±0.31% (93 runs sampled)
    JS PARSER: + multiple chunks in a string x 2,264,354 ops/sec ±0.29% (94 runs sampled)
    HIREDIS BUF:   + multiple chunks in a string x 953,733 ops/sec ±2.03% (82 runs sampled)
    JS PARSER BUF: + multiple chunks in a string x 2,298,458 ops/sec ±0.79% (96 runs sampled)

    HIREDIS:   $ 4mb bulk string x 152 ops/sec ±2.03% (72 runs sampled)
    JS PARSER: $ 4mb bulk string x 971 ops/sec ±0.79% (86 runs sampled)
    HIREDIS BUF:   $ 4mb bulk string x 169 ops/sec ±2.25% (71 runs sampled)
    JS PARSER BUF: $ 4mb bulk string x 797 ops/sec ±7.08% (77 runs sampled)

    HIREDIS:   + simple string x 3,341,956 ops/sec ±1.01% (94 runs sampled)
    JS PARSER: + simple string x 5,979,545 ops/sec ±0.38% (96 runs sampled)
    HIREDIS BUF: + simple string x 1,031,745 ops/sec ±2.17% (76 runs sampled)
    JS PARSER BUF: + simple string x 6,960,184 ops/sec ±0.28% (93 runs sampled)

    HIREDIS:   : integer x 3,897,626 ops/sec ±0.42% (91 runs sampled)
    JS PARSER: : integer x 37,035,812 ops/sec ±0.32% (94 runs sampled)
    JS PARSER STR: : integer x 25,515,070 ops/sec ±1.79% (83 runs sampled)

    HIREDIS:   : big integer x 3,036,704 ops/sec ±0.47% (92 runs sampled)
    JS PARSER: : big integer x 10,616,464 ops/sec ±0.94% (94 runs sampled)
    JS PARSER STR: : big integer x 7,098,146 ops/sec ±0.47% (94 runs sampled)

    HIREDIS:   * array x 51,542 ops/sec ±0.35% (94 runs sampled)
    JS PARSER: * array x 87,090 ops/sec ±2.17% (94 runs sampled)
    HIREDIS BUF:   * array x 11,733 ops/sec ±1.80% (80 runs sampled)
    JS PARSER BUF: * array x 149,430 ops/sec ±1.50% (88 runs sampled)

    HIREDIS:   * big nested array x 247 ops/sec ±0.93% (73 runs sampled)
    JS PARSER: * big nested array x 286 ops/sec ±0.79% (83 runs sampled)
    HIREDIS BUF:   * big nested array x 217 ops/sec ±1.80% (73 runs sampled)
    JS PARSER BUF: * big nested array x 175 ops/sec ±2.49% (37 runs sampled)

    HIREDIS:   - error x 108,110 ops/sec ±0.63% (84 runs sampled)
    JS PARSER: - error x 172,665 ops/sec ±0.57% (85 runs sampled)

    Platform info:
    OSX 10.12.6
    Node.js 10.0.0
    Intel(R) Core(TM) i7-5600U CPU

## License

[MIT](./LICENSE)
