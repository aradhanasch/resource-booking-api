// An error we throw ON PURPOSE, for situations we expect and want to
// show the user a clean message for (as opposed to a random bug/crash).
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // marks this as a "known, safe to show" error
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;