const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Shared guard for every :id route below — req.params.id is always a raw
// string from the URL. Without this, a non-numeric id (e.g. "abc") reaches
// Postgres unvalidated and throws a raw 22P02, which isn't marked
// isOperational and falls through to a generic 500 instead of a clean 400.
function parseId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('Invalid resource id', 400);
  }
  return id;
}

// Validates and cleans the fields of a resource. Throws a 400 AppError on bad
// input, so malformed data never reaches Postgres (which would answer with a
// raw error that the error handler turns into a confusing 500).
// requireAll = true  -> create: name and type are mandatory
// requireAll = false -> update: every field is optional, but any field that
//                       IS provided must be valid
function validateResourceInput(body, { requireAll }) {
  const { name, type, capacity, location, features } = body || {};
  const clean = {};

  if (requireAll || name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new AppError('name must be a non-empty string', 400);
    }
    clean.name = name.trim();
  }

  if (requireAll || type !== undefined) {
    if (typeof type !== 'string' || type.trim() === '') {
      throw new AppError('type must be a non-empty string', 400);
    }
    clean.type = type.trim();
  }

  if (capacity !== undefined && capacity !== null) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new AppError('capacity must be a positive whole number', 400);
    }
    clean.capacity = capacity;
  }

  if (location !== undefined && location !== null) {
    if (typeof location !== 'string') {
      throw new AppError('location must be a string', 400);
    }
    clean.location = location.trim();
  }

  if (features !== undefined && features !== null) {
    if (!Array.isArray(features) || !features.every((f) => typeof f === 'string' && f.trim() !== '')) {
      throw new AppError('features must be an array of non-empty strings', 400);
    }
    clean.features = features.map((f) => f.trim());
  }

  return clean;
}

// GET /api/resources — public, list all resources
const getResources = asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM resources ORDER BY id');
  res.json({ success: true, resources: result.rows });
});

// GET /api/resources/:id — public, single resource
const getResourceById = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const result = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  res.json({ success: true, resource: result.rows[0] });
});

// POST /api/resources — admin only
const createResource = asyncHandler(async (req, res) => {
  const { name, type, capacity, location, features } = validateResourceInput(req.body, {
    requireAll: true,
  });

  const result = await pool.query(
    `INSERT INTO resources (name, type, capacity, location, features)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, type, capacity ?? null, location ?? null, features ?? []]
  );

  res.status(201).json({ success: true, resource: result.rows[0] });
});

// PUT /api/resources/:id — admin only
const updateResource = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const fields = validateResourceInput(req.body, { requireAll: false });

  if (Object.keys(fields).length === 0) {
    throw new AppError('Provide at least one field to update', 400);
  }

  const { name, type, capacity, location, features } = fields;

  const result = await pool.query(
    `UPDATE resources
     SET name = COALESCE($1, name),
         type = COALESCE($2, type),
         capacity = COALESCE($3, capacity),
         location = COALESCE($4, location),
         features = COALESCE($5, features)
     WHERE id = $6
     RETURNING *`,
    [name, type, capacity, location, features, id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  res.json({ success: true, resource: result.rows[0] });
});

// DELETE /api/resources/:id — admin only
const deleteResource = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);

  let result;
  try {
    result = await pool.query('DELETE FROM resources WHERE id = $1 RETURNING id', [id]);
  } catch (err) {
    // 23503 = foreign_key_violation: bookings still reference this resource
    if (err.code === '23503') {
      throw new AppError('Cannot delete a resource that has bookings', 409);
    }
    throw err;
  }

  if (result.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  res.json({ success: true, message: 'Resource deleted' });
});

module.exports = { getResources, getResourceById, createResource, updateResource, deleteResource };