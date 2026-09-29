const pool = require('../db/pool');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/resources — public, list all resources
const getResources = asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM resources ORDER BY id');
  res.json({ success: true, resources: result.rows });
});

// GET /api/resources/:id — public, single resource
const getResourceById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  res.json({ success: true, resource: result.rows[0] });
});

// POST /api/resources — admin only
const createResource = asyncHandler(async (req, res) => {
  const { name, type, capacity, location, features } = req.body;

  if (!name || !type) {
    throw new AppError('Name and type are required', 400);
  }

  const result = await pool.query(
    `INSERT INTO resources (name, type, capacity, location, features)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, type, capacity || null, location || null, features || []]
  );

  res.status(201).json({ success: true, resource: result.rows[0] });
});

// PUT /api/resources/:id — admin only
const updateResource = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, type, capacity, location, features } = req.body;

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
  const { id } = req.params;
  const result = await pool.query('DELETE FROM resources WHERE id = $1 RETURNING id', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Resource not found', 404);
  }

  res.json({ success: true, message: 'Resource deleted' });
});

module.exports = { getResources, getResourceById, createResource, updateResource, deleteResource };