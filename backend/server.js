import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import authRoutes from './routes/auth.js';
import sourceRoutes from './routes/sources.js';
import newspaperRoutes from './routes/newspaper.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// CORS setup enabling frontend origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all local dev origins
    }
  },
  credentials: true
}));

// Body Parser Middleware
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/newspaper', newspaperRoutes);

// Base Health Route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'FeedToRead Backend API',
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`FeedToRead Backend Server running on port ${PORT}`);
});
