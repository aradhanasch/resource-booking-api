const jwt = require('jsonwebtoken');

// Signs a JWT containing just the user's id.
// We keep the payload minimal — the token is decoded on every
// protected request, so smaller = faster, and we don't want to bake
// in data (like role) that could go stale between login and use.
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

module.exports = generateToken;