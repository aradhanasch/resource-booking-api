const { Pool } = require('pg');
require('dotenv').config();

// A pool keeps a small set of DB connections open and reuses them across
// requests, instead of opening a brand-new connection for every query.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL, even for the direct connection
});

// Fail loudly at startup if the DB is unreachable, instead of only
// discovering it later on the first real request.
pool.query('SELECT NOW()')
  .then((res) => console.log(' PostgreSQL connected:', res.rows[0].now))
  .catch((err) => console.error(' PostgreSQL connection failed:', err.message));

module.exports = pool;