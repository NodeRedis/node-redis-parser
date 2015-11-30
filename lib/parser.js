'use strict';

var parsers = {
    javascript: require('./javascript')
};

// Hiredis might not be installed
try {
    parsers.hiredis = require('./hiredis');
} catch (err) { /* ignore errors */ }

function Parser (options) {
    var parser;

    if (
        !options ||
        typeof options.returnError !== 'function' ||
        typeof options.returnReply !== 'function'
    ) {
        throw new Error('Please provide all return functions while initiating the parser');
    }

    /* istanbul ignore if: hiredis should always be installed while testing */
    if (options.name === 'hiredis' && !parsers.hiredis) {
        console.warn('<< WARNING >> You explicitly required the hiredis parser but hiredis is not installed. The js parser is going to be returned instead.');
    }

    options.name = options.name || 'hiredis';
    options.name = options.name.toLowerCase();
    options.returnBuffers = options.returnBuffers || false;

    if (options.name === 'javascript' || !parsers.hiredis) {
        parser = new parsers.javascript(options.returnBuffers);
    } else {
        parser = new parsers.hiredis(options.returnBuffers);
    }

    parser.returnError = options.returnError;
    parser.returnFatalError = options.returnFatalError || options.returnError;
    parser.returnReply = options.returnReply;
    return parser;
}

module.exports = Parser;
