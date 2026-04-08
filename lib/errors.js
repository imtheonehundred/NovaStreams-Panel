'use strict';

class ConflictError extends Error {
  constructor(message, meta = {}) {
    super(message || 'Conflict');
    this.name = 'ConflictError';
    this.statusCode = 409;
    Object.assign(this, meta);
  }
}

module.exports = {
  ConflictError,
};
