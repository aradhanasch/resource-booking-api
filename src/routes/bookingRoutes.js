const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requireAdmin = require('../middleware/requireAdmin');
const {
  createBooking,
  getAllBookings,
  getMyBookings,
  getBookingById,
  cancelBooking,
} = require('../controllers/bookingController');

// Every booking route requires login
router.use(isAuthenticated);

router.post('/', createBooking);
router.get('/', requireAdmin, getAllBookings); // admin only; isAuthenticated already ran above
router.get('/my', getMyBookings);   // must stay ABOVE '/:id', or "my" is read as an id
router.get('/:id', getBookingById);
router.delete('/:id', cancelBooking);

module.exports = router;