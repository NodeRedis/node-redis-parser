'use strict';

var util = require('util');

function JavascriptReplyParser(return_buffers) {
    this.name = 'javascript';
    this.buffer = new Buffer(0);
    this.offset = 0;
    this.bigStrSize = 0;
    this.chunksSize = 0;
    this.buffers = [];
    this.type = 0;
    this.protocolError = false;
    this.offsetCache = 0;
    if (return_buffers) {
        this.handleReply = function (start, end) {
            return this.buffer.slice(start, end);
        };
    }
}

JavascriptReplyParser.prototype.handleReply = function (start, end) {
    return this.buffer.toString('utf-8', start, end);
};

function IncompleteReadBuffer(message) {
    this.name = 'IncompleteReadBuffer';
    this.message = message;
}
util.inherits(IncompleteReadBuffer, Error);

JavascriptReplyParser.prototype.parseResult = function (type) {
    var start = 0,
        end = 0,
        packetHeader = 0,
        reply;

    if (type === 36) { // $
        packetHeader = this.parseHeader();
        // Packets with a size of -1 are considered null
        if (packetHeader === -1) {
            return null;
        }
        end = this.offset + packetHeader;
        start = this.offset;
        if (end + 2 > this.buffer.length) {
            this.buffers.push(this.offsetCache === 0 ? this.buffer : this.buffer.slice(this.offsetCache));
            this.chunksSize = this.buffers[0].length;
            // Include the packetHeader delimiter
            this.bigStrSize = packetHeader + 2;
            throw new IncompleteReadBuffer('Wait for more data.');
        }
        // Set the offset to after the delimiter
        this.offset = end + 2;
        return this.handleReply(start, end);
    } else if (type === 58) { // :
        // Up to the delimiter
        end = this.packetEndOffset();
        start = this.offset;
        // Include the delimiter
        this.offset = end + 2;
        // Return the coerced numeric value
        return +this.buffer.toString('ascii', start, end);
    } else if (type === 43) { // +
        end = this.packetEndOffset();
        start = this.offset;
        this.offset = end + 2;
        return this.handleReply(start, end);
    } else if (type === 42) { // *
        packetHeader = this.parseHeader();
        if (packetHeader === -1) {
            return null;
        }
        reply = [];
        for (var i = 0; i < packetHeader; i++) {
            if (this.offset >= this.buffer.length) {
                throw new IncompleteReadBuffer('Wait for more data.');
            }
            reply.push(this.parseResult(this.buffer[this.offset++]));
        }
        return reply;
    } else if (type === 45) { // -
        end = this.packetEndOffset();
        start = this.offset;
        this.offset = end + 2;
        return new Error(this.buffer.toString('utf-8', start, end));
    } else {
        return void 0;
    }
};

JavascriptReplyParser.prototype.execute = function (buffer) {
    if (this.chunksSize !== 0) {
        if (this.bigStrSize > this.chunksSize + buffer.length) {
            this.buffers.push(buffer);
            this.chunksSize += buffer.length;
            return;
        }
        this.buffers.push(buffer);
        this.buffer = Buffer.concat(this.buffers, this.chunksSize + buffer.length);
        this.buffers = [];
        this.bigStrSize = 0;
        this.chunksSize = 0;
    } else if (this.offset >= this.buffer.length) {
        this.buffer = buffer;
    } else {
        this.buffer = Buffer.concat([this.buffer.slice(this.offset), buffer]);
    }
    this.offset = 0;
    this.protocolError = true;
    this.run();
};

JavascriptReplyParser.prototype.tryParsing = function () {
    try {
        return this.parseResult(this.type);
    } catch (err) {
        // Catch the error (not enough data), rewind if it's an array,
        // and wait for the next packet to appear
        this.offset = this.offsetCache;
        this.protocolError = false;
        return void 0;
    }
};

JavascriptReplyParser.prototype.run = function () {
    // Set a rewind point. If a failure occurs, wait for the next execute()/append() and try again
    this.offsetCache = this.offset;
    this.type = this.buffer[this.offset++];
    var reply = this.tryParsing();

    while (reply !== undefined) {
        if (this.type === 45) { // Errors -
            this.returnError(reply);
        } else {
            this.returnReply(reply); // Strings + // Integers : // Bulk strings $ // Arrays *
        }
        this.offsetCache = this.offset;
        this.type = this.buffer[this.offset++];
        reply = this.tryParsing();
    }
    if (this.type !== undefined && this.protocolError === true) {
        // Reset the buffer so the parser can handle following commands properly
        this.buffer = new Buffer(0);
        this.returnFatalError(new Error('Protocol error, got ' + JSON.stringify(String.fromCharCode(this.type)) + ' as reply type byte'));
    }
};

JavascriptReplyParser.prototype.parseHeader = function () {
    var end   = this.packetEndOffset(),
        value = this.buffer.toString('ascii', this.offset, end) | 0;

    this.offset = end + 2;
    return value;
};

JavascriptReplyParser.prototype.packetEndOffset = function () {
    var offset = this.offset,
        len = this.buffer.length - 1;

    while (this.buffer[offset] !== 0x0d && this.buffer[offset + 1] !== 0x0a) {
        offset++;

        if (offset >= len) {
            throw new IncompleteReadBuffer('Did not see LF after NL reading multi bulk count (' + offset + ' => ' + this.buffer.length + ', ' + this.offset + ')');
        }
    }
    return offset;
};

module.exports = JavascriptReplyParser;
