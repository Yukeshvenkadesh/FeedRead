import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Source from '../models/Source.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || 'feedtoread_secret_key_2026_broadsheet',
    { expiresIn: '30d' }
  );
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email: rawEmail, password } = req.body;

    if (!rawEmail || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const email = rawEmail.toLowerCase().trim();

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'A subscriber with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: name.trim(),
      email,
      password_hash,
      last_checked_at: new Date(),
      created_at: new Date()
    });

    // Seed initial default sources for new subscriber
    try {
      const defaultSeeds = [
        { name: 'The Hindu', type: 'BLOG', url: 'https://www.thehindu.com', isActive: true },
        { name: 'Times of India', type: 'BLOG', url: 'https://timesofindia.indiatimes.com', isActive: true },
        { name: 'Daily Thanthi', type: 'NEWSLETTER', url: 'https://dailythanthi.com', isActive: true },
        { name: 'The Verge', type: 'BLOG', url: 'https://theverge.com', isActive: true }
      ];
      await Source.insertMany(defaultSeeds.map(s => ({
        userId: user._id,
        name: s.name,
        sourceName: s.name,
        type: s.type,
        sourceType: s.type,
        url: s.url,
        isActive: s.isActive
      })));
    } catch (seedErr) {
      console.error('Failed to seed default sources on registration:', seedErr);
    }

    const token = generateToken(user._id);

    return res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token,
      last_checked_at: user.last_checked_at,
      created_at: user.created_at
    });
  } catch (error) {
    console.error('Register Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;

    if (!rawEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const email = rawEmail.toLowerCase().trim();

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid subscriber credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid subscriber credentials.' });
    }

    const token = generateToken(user._id);

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token,
      last_checked_at: user.last_checked_at,
      created_at: user.created_at
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json(user);
  } catch (error) {
    console.error('Auth Me Error:', error);
    return res.status(500).json({ message: error.message });
  }
});

export default router;
