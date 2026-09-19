import express from 'express';
import Source from '../models/Source.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/sources/active-targets -> For teammate's pipeline to retrieve channels to scrape
router.get('/active-targets', async (req, res) => {
  try {
    const { type } = req.query; // e.g. ?type=YOUTUBE
    const filter = { isActive: true };
    if (type) filter.sourceType = type.toUpperCase();

    const targets = await Source.aggregate([
      { $match: filter },
      { $group: { _id: { name: "$sourceName", type: "$sourceType" }, subscribersCount: { $sum: 1 } } },
      { $project: { _id: 0, sourceName: "$_id.name", sourceType: "$_id.type", subscribersCount: 1 } }
    ]);

    return res.json({ targets });
  } catch (err) {
    console.error("Failed to fetch active targets:", err);
    return res.status(500).json({ error: 'Failed to fetch targets for scraper' });
  }
});

// GET /api/sources -> Fetch saved sources for the logged-in user session
router.get('/', verifyToken, async (req, res) => {
  try {
    const sources = await Source.find({ userId: req.user.id }).sort({ addedAt: -1 });
    return res.json({ sources: sources || [] });
  } catch (err) {
    console.error("Failed to fetch sources:", err);
    return res.status(500).json({ error: 'Failed to fetch wire sources' });
  }
});

// POST /api/sources -> Add a new wire source from the form (e.g., madan gowri / YOUTUBE)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { sourceName, sourceType, name, type } = req.body;
    const rawName = sourceName || name;
    const rawType = sourceType || type;

    if (!rawName || !rawType) {
      return res.status(400).json({ error: 'sourceName and sourceType are required' });
    }

    const cleanName = rawName.trim();
    let cleanType = rawType.toUpperCase();
    if (cleanType.includes('YOUTUBE')) cleanType = 'YOUTUBE';
    else if (cleanType.includes('BLOG')) cleanType = 'BLOG';
    else if (cleanType.includes('NEWSLETTER')) cleanType = 'NEWSLETTER';
    else if (cleanType.includes('RSS')) cleanType = 'RSS';

    const source = await Source.findOneAndUpdate(
      { userId: req.user.id, sourceName: cleanName },
      { userId: req.user.id, sourceName: cleanName, sourceType: cleanType, isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ source });
  } catch (err) {
    console.error("Error saving source:", err);
    return res.status(500).json({ error: 'Failed to persist source to database' });
  }
});

// PATCH /api/sources/:id/toggle -> Toggle active status
router.patch('/:id/toggle', verifyToken, async (req, res) => {
  try {
    const source = await Source.findOne({ _id: req.params.id, userId: req.user.id });
    if (!source) return res.status(404).json({ error: 'Source not found' });
    
    source.isActive = !source.isActive;
    await source.save();

    return res.json({ source });
  } catch (err) {
    console.error("Error toggling source:", err);
    return res.status(500).json({ error: 'Failed to toggle source' });
  }
});

// DELETE /api/sources/:id -> Unsubscribe / remove a wire source
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const result = await Source.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!result) return res.status(404).json({ error: 'Source not found' });
    return res.json({ message: 'Source deleted successfully' });
  } catch (err) {
    console.error("Error deleting source:", err);
    return res.status(500).json({ error: 'Failed to delete source' });
  }
});

export default router;
