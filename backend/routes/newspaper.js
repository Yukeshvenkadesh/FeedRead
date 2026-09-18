import express from 'express';
import Edition from '../models/Edition.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Story generation pool
const BASE_STORIES = [
  {
    id: 'story-001',
    headline: 'Apple Unveils M4 Silicon with Dedicated Local AI Acceleration',
    category: 'Technology',
    stance: 'Neutral',
    importance: 'lead',
    summary: 'Apple officially debuted its next-generation M4 architecture, placing unprecedented emphasis on local inference capabilities and power efficiency. The silicon redesign targets demanding on-device neural workloads without forcing users to offload computations to cloud services.',
    sources: [
      { name: 'MKBHD', url: 'https://youtube.com', type: 'YOUTUBE' },
      { name: 'TechCrunch', url: 'https://techcrunch.com', type: 'BLOG' }
    ]
  },
  {
    id: 'story-002',
    headline: 'OpenAI Releases Open Weights Research Suite to Global Labs',
    category: 'Technology',
    stance: 'Positive',
    importance: 'major',
    summary: 'In an unexpected strategic shift, the research team published weights for an open alignment model, emphasizing collaborative safety audits and decentralized model verification.',
    sources: [
      { name: 'The Verge', url: 'https://theverge.com', type: 'BLOG' }
    ]
  },
  {
    id: 'story-003',
    headline: 'Critique: The Fragile Economics of Subsidized Cloud Compute',
    category: 'Opinion',
    stance: 'Negative',
    importance: 'major',
    summary: 'Escalating operational expenses for generative workloads are threatening software startup margins. Industry observers warn that current flat-rate pricing models cannot survive high-token production usage.',
    sources: [
      { name: 'Stratechery', url: 'https://stratechery.com', type: 'NEWSLETTER' }
    ]
  },
  {
    id: 'story-004',
    headline: 'SpaceX Completes 48-Hour Rapid Turnaround Booster Milestone',
    category: 'Science',
    stance: 'Neutral',
    importance: 'minor',
    summary: 'Operational cadence reached a new peak this morning as commercial launch crews cleared static fire tests and turnaround inspections in under two days.',
    sources: [
      { name: 'Everyday Astronaut', url: 'https://youtube.com', type: 'YOUTUBE' }
    ]
  },
  {
    id: 'story-005',
    headline: 'Frontier AI Governance Framework Ratified by 18 Global Nations',
    category: 'Technology',
    stance: 'Positive',
    importance: 'major',
    summary: 'An international accord setting rigorous testing benchmarks for multi-modal sovereign models was signed today, establishing standardized audit criteria for high-compute datacenters.',
    sources: [
      { name: 'Financial Times', url: 'https://ft.com', type: 'BLOG' },
      { name: 'Stratechery', url: 'https://stratechery.com', type: 'NEWSLETTER' }
    ]
  },
  {
    id: 'story-006',
    headline: 'Solid-State Battery Breakthrough Yields 800-Mile Density Lab Test',
    category: 'Science',
    stance: 'Positive',
    importance: 'minor',
    summary: 'Researchers demonstrate a dendrite-resistant ceramic separator that operates stably through 1,200 fast-charge thermal cycles without measurable degradation.',
    sources: [
      { name: 'Ars Technica', url: 'https://arstechnica.com', type: 'BLOG' }
    ]
  }
];

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STAGE_JSON_PATH = path.resolve(__dirname, '../../newsletter_service/newsletter_stage.json');

const getLiveNewsletterStories = (editionNumber = 1, date = new Date()) => {
  try {
    if (fs.existsSync(STAGE_JSON_PATH)) {
      const raw = fs.readFileSync(STAGE_JSON_PATH, 'utf-8');
      const stagedArticles = JSON.parse(raw);

      if (Array.isArray(stagedArticles) && stagedArticles.length > 0) {
        return stagedArticles.map((art, idx) => {
          // Determine importance based on position
          let importance = 'minor';
          if (idx === 0) importance = 'lead';
          else if (idx === 1 || idx === 2 || idx === 3) importance = 'major';

          // Clean source name (e.g. "The Hindu (Tech)" -> "The Hindu", "Daily Thanthi (Tamil)" -> "Daily Thanthi")
          let sourceName = (art.source || 'Digital Wire').replace(/\s*\([^)]*\)/g, '').trim();

          // Determine category based on content and source
          let category = 'Technology';
          const textToScan = ((art.headline || '') + ' ' + (art.content || '')).toLowerCase();
          const srcLower = (art.source || '').toLowerCase();

          if (srcLower.includes('tamil') || srcLower.includes('thanthi') || srcLower.includes('dinamani') || textToScan.includes('editorial') || textToScan.includes('opinion')) {
            category = 'Opinion';
          } else if (textToScan.includes('bank') || textToScan.includes('pay') || textToScan.includes('business') || textToScan.includes('market') || textToScan.includes('shares')) {
            category = 'Business';
          } else if (textToScan.includes('science') || textToScan.includes('drone') || textToScan.includes('battery') || textToScan.includes('space') || textToScan.includes('research')) {
            category = 'Science';
          } else {
            category = 'Technology';
          }

          // Clean summary (first ~350-420 chars of content)
          let summary = (art.content || art.headline || '').trim();
          if (summary.length > 450) {
            summary = summary.substring(0, 420) + '...';
          }

          return {
            id: `story-live-${editionNumber}-${idx + 1}-${Date.now().toString(36)}`,
            headline: art.headline || 'Digital Wire Dispatch',
            category,
            stance: idx % 3 === 0 ? 'Positive' : (idx % 3 === 1 ? 'Neutral' : 'Negative'),
            importance,
            summary,
            imageUrl: art.image_url || null,
            sources: [
              {
                name: sourceName,
                url: art.url || 'https://news.google.com',
                type: 'BLOG'
              }
            ],
            timestamp: art.published_at ? new Date(art.published_at) : new Date(date.getTime() - idx * 10 * 60 * 1000)
          };
        });
      }
    }
  } catch (err) {
    console.error('Error reading newsletter_stage.json:', err.message);
  }

  // Fallback to simulated data only if newsletter_stage.json is empty or missing
  return BASE_STORIES.map((story, idx) => ({
    ...story,
    id: `story-ed${editionNumber}-${idx + 1}-${Date.now().toString(36)}`,
    timestamp: new Date(date.getTime() - idx * 12 * 60 * 1000)
  }));
};

// All newspaper routes are protected
router.use(protect);

// Helper: Get local date formatting YYYY-MM-DD instead of UTC
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`; // Evaluates to "2026-09-19"
}

// 1. GET /api/newspaper/latest - Initial Login / First Edition Fetch
router.get('/latest', async (req, res) => {
  try {
    const today = getLocalDateString();

    // Find existing editions for this user created today, sorted by editionNumber: -1
    const todaysEditions = await Edition.find({
      userId: req.user.id,
      dateString: today
    }).sort({ editionNumber: -1 });

    if (todaysEditions.length === 0) {
      // 0 editions exist for today: Automatically synthesize Edition #1
      const now = new Date();
      const stories = getLiveNewsletterStories(1, now);

      const firstEdition = await Edition.create({
        userId: req.user.id,
        editionNumber: 1,
        dateString: today,
        stories,
        createdAt: now
      });

      await User.findByIdAndUpdate(req.user.id, { last_checked_at: now });

      return res.json(firstEdition);
    }

    // Return the latest edition for today
    return res.json(todaysEditions[0]);
  } catch (error) {
    console.error('Get Latest Edition Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/newspaper/refresh - Refresh / Print New Edition with Deduplication
router.post('/refresh', async (req, res) => {
  try {
    const today = getLocalDateString();
    const now = new Date();

    // Fetch all editions generated for this user today
    const priorEditionsToday = await Edition.find({
      userId: req.user.id,
      dateString: today
    }).sort({ editionNumber: 1 });

    // Build a Set of all previously printed article URLs and headlines
    const seenUrls = new Set();
    const seenHeadlines = new Set();

    priorEditionsToday.forEach(ed => {
      ed.stories.forEach(story => {
        if (story.sources && story.sources[0]?.url) {
          seenUrls.add(story.sources[0].url.trim().toLowerCase());
        }
        if (story.headline) {
          seenHeadlines.add(story.headline.trim().toLowerCase());
        }
      });
    });

    // Filter Incoming News Candidates
    const candidateArticles = getLiveNewsletterStories(); // Loads newsletter_stage.json

    const freshArticles = candidateArticles.filter(art => {
      const cleanUrl = (art.sources?.[0]?.url || "").trim().toLowerCase();
      const cleanHeadline = (art.headline || "").trim().toLowerCase();

      const isDuplicate = seenUrls.has(cleanUrl) || seenHeadlines.has(cleanHeadline);
      return !isDuplicate;
    });

    // Handle Issue Creation
    if (freshArticles.length === 0) {
      const latestEdition = priorEditionsToday.length > 0 
        ? priorEditionsToday[priorEditionsToday.length - 1] 
        : null;

      return res.status(200).json({
        isNew: false,
        edition: latestEdition,
        message: "Presses waiting: No fresh dispatches since previous edition."
      });
    }

    const nextEditionNumber = priorEditionsToday.length + 1;
    const formattedStories = freshArticles.map((art, idx) => {
      let importance = 'minor';
      if (idx === 0) importance = 'lead';
      else if (idx === 1 || idx === 2 || idx === 3) importance = 'major';

      return {
        ...art,
        id: `story-live-${nextEditionNumber}-${idx + 1}-${Date.now().toString(36)}`,
        importance,
        imageUrl: art.imageUrl || art.image_url || null,
        timestamp: art.timestamp || now
      };
    });

    const newEdition = await Edition.create({
      userId: req.user.id,
      editionNumber: nextEditionNumber,
      dateString: today,
      stories: formattedStories,
      createdAt: now
    });

    await User.findByIdAndUpdate(req.user.id, { last_checked_at: now });

    return res.status(201).json({
      isNew: true,
      edition: newEdition,
      message: `Fresh issue published: Edition #${nextEditionNumber}`
    });
  } catch (error) {
    console.error('Refresh Edition Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 2.5 GET /api/newspaper/archive - Query Editions by Date (YYYY-MM-DD or DD/MM/YYYY)
router.get('/archive', async (req, res) => {
  try {
    let { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: "Date query param required (YYYY-MM-DD)" });
    }

    // Convert DD/MM/YYYY to YYYY-MM-DD if sent in UK/Indian format
    if (date.includes('/')) {
      const parts = date.split('/');
      if (parts[0].length === 2) {
        date = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    const editions = await Edition.find({
      userId: req.user.id,
      dateString: date
    }).sort({ editionNumber: 1 });

    return res.json({ editions });
  } catch (err) {
    console.error("Archive fetch error:", err);
    return res.status(500).json({ message: "Error fetching archived editions" });
  }
});

// 3. GET /api/newspaper/archives - Archive Metadata List Grouped by Date
router.get('/archives', async (req, res) => {
  try {
    const allEditions = await Edition.find({ userId: req.user.id })
      .select('_id editionNumber dateString createdAt')
      .sort({ createdAt: -1 });

    // Group by dateString
    const groupedMap = new Map();

    allEditions.forEach((ed) => {
      const d = ed.dateString || getLocalDateString(new Date(ed.createdAt));
      if (!groupedMap.has(d)) {
        groupedMap.set(d, []);
      }
      groupedMap.get(d).push({
        _id: ed._id,
        editionNumber: ed.editionNumber,
        createdAt: ed.createdAt
      });
    });

    const result = Array.from(groupedMap.entries()).map(([date, editions]) => ({
      date,
      count: editions.length,
      editions: editions.sort((a, b) => a.editionNumber - b.editionNumber)
    }));

    return res.json(result);
  } catch (error) {
    console.error('Get Archives Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 4. GET /api/newspaper/edition/:id - Fetch Specific Historical Edition
router.get('/edition/:id', async (req, res) => {
  try {
    const edition = await Edition.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!edition) {
      return res.status(404).json({ error: 'Edition not found or unauthorized' });
    }

    return res.json(edition);
  } catch (error) {
    console.error('Get Historical Edition Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;

