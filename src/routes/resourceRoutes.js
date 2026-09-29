const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requireAdmin = require('../middleware/requireAdmin');
const {
  getResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} = require('../controllers/resourceController');

// Public routes
router.get('/', getResources);
router.get('/:id', getResourceById);

// Admin-only routes — middlewares run left to right:
// isAuthenticated sets req.userId, THEN requireAdmin checks the role
router.post('/', isAuthenticated, requireAdmin, createResource);
router.put('/:id', isAuthenticated, requireAdmin, updateResource);
router.delete('/:id', isAuthenticated, requireAdmin, deleteResource);

module.exports = router;