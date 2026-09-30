const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const {
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
} = require('../controllers/bookingController');

// Every booking route requires login
router.use(isAuthenticated);

router.post('/', createBooking);
router.get('/my', getMyBookings);   // must stay ABOVE '/:id', or "my" is read as an id
router.get('/:id', getBookingById);
router.delete('/:id', cancelBooking);

module.exports = router;