const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

// Protects a route: verifies the JWT from the Authorization header
// and attaches req.userId so controllers know who's making the request.
const isAuthenticated = (req, res, next) => {
  const authHeader = req.headers.authorization; // expected format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Not authenticated', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    next(new AppError('Invalid or expired token', 401));
  }
};

module.exports = isAuthenticated;