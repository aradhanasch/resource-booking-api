const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const generateToken = require('../utils/generateToken');

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, password } = req.body;
  // Normalize once, use everywhere below — "User@Test.com" and
  // "user@test.com" must be treated as the same account.
  const email = req.body.email?.trim().toLowerCase();

  if (!name || !email || !password) {
    throw new AppError('Name, email, and password are required', 400);
  }

  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  // Check if a user with this email already exists. This check narrows
  // the window but doesn't close it — two requests can both pass it
  // before either INSERTs. The catch block below closes that gap using
  // the database's own unique constraint as the real source of truth.
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  // Hash the password — NEVER store plain text passwords.
  // 10 is the "salt rounds": higher = slower to hash but harder to brute-force.
  const passwordHash = await bcrypt.hash(password, 10);

  let result;
  try {
    result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name, email, passwordHash]
    );
  } catch (err) {
    // 23505 = unique_violation. Two registration requests for the same
    // email can both pass the SELECT check above before either commits
    // its INSERT — this is that race, closed by the database's own
    // unique constraint on users.email rather than by application code.
    if (err.code === '23505') {
      throw new AppError('Email already registered', 409);
    }
    throw err;
  }

  const user = result.rows[0];
  const token = generateToken(user.id);

  res.status(201).json({ success: true, user, token });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const email = req.body.email?.trim().toLowerCase();

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  // Deliberately vague error message — don't reveal whether the
  // email exists or the password was wrong. Prevents attackers from
  // using your login endpoint to check which emails are registered.
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new AppError('Invalid email or password', 401);
  }

  const token = generateToken(user.id);

  res.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token,
  });
});

module.exports = { register, login };