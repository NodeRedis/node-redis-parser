'use strict';

var hiredis = require('hiredis');

function HiredisReplyParser(returnBuffers) {
    this.name = 'hiredis';
    this.returnBuffers = returnBuffers;
    this.reader = new hiredis.Reader({
        return_buffers: returnBuffers
    });
}

HiredisReplyParser.prototype.parseData = function () {
    try {
        return this.reader.get();
    } catch (err) {
        // Protocol errors land here
        // Reset the parser. Otherwise new commands can't be processed properly
        this.reader = new hiredis.Reader({
            return_buffers: this.returnBuffers
        });
        this.returnFatalError(err);
        return void 0;
    }
};

HiredisReplyParser.prototype.execute = function (data) {
    this.reader.feed(data);
    var reply = this.parseData();

    while (reply !== undefined) {
        if (reply && reply.name === 'Error') {
            this.returnError(reply);
        } else {
            this.returnReply(reply);
        }
        reply = this.parseData();
    }
};

module.exports = HiredisReplyParser;
