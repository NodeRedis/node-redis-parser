[![Build Status](https://travis-ci.org/NodeRedis/redis-parser.png?branch=master)](https://travis-ci.org/NodeRedis/redis-parser)

# redis-parser

A high performance redis parser solution built for [node_redis](https://github.com/NodeRedis/node_redis) and [ioredis](https://github.com/ioredis/luin).

## Install

Install with [NPM](https://npmjs.org/):

```
npm install redis-parser
```

## Usage

```js
new Parser(options);
```

### Possible options

`returnReply`: *function*; mandatory
`returnError`: *function*; mandatory
`returnFatalError`: *function*; optional, defaults to the returnError function
`returnBuffers`: *boolean*; optional, defaults to false
`name`: *javascript|hiredis*; optional, defaults to hiredis and falls back to the js parser if not available
`context`: *A class instance that the return functions get bound to*; optional

### Example

```js
var Parser = require("redis-parser");

function Library () {}

Library.prototype.returnReply = function (reply) { ... }
Library.prototype.returnError = function (err) { ... }
Library.prototype.returnFatalError = function (err) { ... }

var lib = new Library();

var parser = new Parser({
    returnReply: returnReply,
    returnError: returnError,
    returnFatalError: returnFatalError,
    context: lib
}); // This returns either a hiredis or the js parser instance depending on what's available

Library.prototype.streamHandler = function () {
    this.stream.on('data', function (buffer) {
        // Here the data (e.g. `new Buffer('$5\r\nHello\r\n'`)) is passed to the parser and the result is passed to either function depending on the provided data.
        // All [RESP](http://redis.io/topics/protocol) data will be properly parsed by the parser.
        parser.execute(buffer);
    });
};
```
You do not have to use the context variable, but can also bind the function while passing them to the option object.

And if you want to return buffers instead of strings, you can do this by adding the returnBuffers option.

```js
// Same functions as in the first example

var parser = new Parser({
    returnReply: returnReply.bind(lib),
    returnError: returnError.bind(lib),
    returnFatalError: returnFatalError.bind(lib),
    returnBuffers: true // All strings are returned as buffer e.g. <Buffer 48 65 6c 6c 6f>
});

// The streamHandler as above
```

## Further info

The [hiredis](https://github.com/redis/hiredis) parser is still the fasted parser for
Node.js and therefor used as default in redis-parser if the hiredis parser is available.

Otherwise the pure js NodeRedis parser is choosen that is almost as fast as the
hiredis parser besides some situations in which it'll be a bit slower.

## Contribute

The js parser is already optimized but there are likely further optimizations possible.
Besides running the tests you'll also have to run the change at least against the node_redis benchmark suite and post the improvement in the PR.
If you want to write a own parser benchmark, that would also be great!

```
npm install
npm test

# Run node_redis benchmark (let's guess you cloned node_redis in another folder)
cd ../redis
npm install
npm run benchmark parser=javascript > old.log
# Replace the changed parser in the node_modules
npm run benchmark parser=javascript > new.log
node benchmarks/diff_multi_bench_output.js old.log new.log > improvement.log
```

## License

[MIT](./LICENSE
