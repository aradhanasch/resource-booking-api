const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const { createBooking, getMyBookings, cancelBooking } = require('../controllers/bookingController');

// Every booking route requires login
router.use(isAuthenticated);

router.post('/', createBooking);
router.get('/my', getMyBookings);
router.delete('/:id', cancelBooking);
module.exports = router;