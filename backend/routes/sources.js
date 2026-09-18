import express from 'express';
import Source from '../models/Source.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// All source routes are protected by JWT verification middleware
router.use(protect);

// 1. GET /api/sources (Read)
// Fetch all sources where userId === req.user.id, sorted by createdAt: -1.
// Return HTTP 200 with the array of source documents.
router.get('/', async (req, res) => {
  try {
    const sources = await Source.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json(sources);
  } catch (error) {
    console.error('Get Sources Error:', error);
    return res.status(500).json({ message: error.message });
  }
});

// 2. POST /api/sources (Create)
// Accept { name, type, url } in req.body.
// Upsert or create: If a source with the same name exists for this user, activate it; otherwise, insert a new Source document.
// Return HTTP 201 with the created/updated source.
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || req.body.sourceName || '').trim();
    const type = req.body.type || req.body.sourceType || 'BLOG';
    const url = (req.body.url || req.body.sourceUrl || '').trim();

    if (!name) {
      return res.status(400).json({ message: 'Source name is required' });
    }

    // Check if source with the same name exists for this user (case-insensitive)
    const existingSource = await Source.findOne({
      userId: req.user.id,
      $or: [
        { name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { sourceName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    });

    if (existingSource) {
      existingSource.isActive = true;
      if (type) {
        existingSource.type = type;
        existingSource.sourceType = type;
      }
      if (url) existingSource.url = url;
      await existingSource.save();
      return res.status(201).json(existingSource);
    }

    const newSource = await Source.create({
      userId: req.user.id,
      name,
      sourceName: name,
      type,
      sourceType: type,
      url,
      isActive: true
    });

    return res.status(201).json(newSource);
  } catch (error) {
    console.error('Add/Upsert Source Error:', error);
    return res.status(500).json({ message: error.message });
  }
});

// 3. PATCH /api/sources/:id/toggle (Update)
// Toggle the isActive boolean flag for _id === req.params.id and userId === req.user.id.
// Return HTTP 200 with the updated document.
router.patch('/:id/toggle', async (req, res) => {
  try {
    const source = await Source.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    source.isActive = !source.isActive;
    await source.save();

    return res.status(200).json(source);
  } catch (error) {
    console.error('Toggle Source Error:', error);
    return res.status(500).json({ message: error.message });
  }
});

// 4. DELETE /api/sources/:id (Delete)
// Remove document matching _id === req.params.id and userId === req.user.id.
// Return HTTP 200 with { message: "Source deleted successfully" }.
router.delete('/:id', async (req, res) => {
  try {
    const source = await Source.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    return res.status(200).json({ message: 'Source deleted successfully' });
  } catch (error) {
    console.error('Delete Source Error:', error);
    return res.status(500).json({ message: error.message });
  }
});

export default router;
