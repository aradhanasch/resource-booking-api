// Registered LAST in server.js. Express routes any error passed to
// next(err) — or thrown inside an asyncHandler-wrapped function —
// straight here, skipping all other middleware in between.
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Known, expected errors (AppError) get their real message.
  // Anything else is an unexpected bug — don't leak internal details to the client.
  const message = err.isOperational ? err.message : 'Something went wrong';

  if (!err.isOperational) {
    console.error('UNEXPECTED ERROR:', err); // log full details for yourself
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};

module.exports = errorHandler;