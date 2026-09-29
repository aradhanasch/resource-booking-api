const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Must run AFTER isAuthenticated — relies on req.userId already being set.
// Checks the user's role fresh from the DB rather than trusting anything
// from the JWT payload, since we deliberately kept the token minimal.
const requireAdmin = asyncHandler(async (req, res, next) => {
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
  const user = result.rows[0];

  if (!user || user.role !== 'admin') {
    throw new AppError('Admin access required', 403);
  }

  next();
});

module.exports = requireAdmin;