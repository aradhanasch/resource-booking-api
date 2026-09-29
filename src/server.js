const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./db/pool'); // runs the connection check on startup
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('../src/routes/authRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const bookingRoutes = require('./routes/bookingRoutes'); 

const app = express();

app.use(cors());          // allows the Vite frontend, on a different port, to call this API
app.use(express.json());  // parses incoming JSON request bodies

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes); // add this — routes above errorHandler
app.use('/api/resources', resourceRoutes);
app.use('/api/bookings', bookingRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));