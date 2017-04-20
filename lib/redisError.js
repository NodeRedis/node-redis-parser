'use strict'

class RedisError extends Error {}

Object.defineProperty(RedisError.prototype, 'name', {
  value: 'RedisError',
  configurable: true,
  writable: true
})

module.exports = RedisError
