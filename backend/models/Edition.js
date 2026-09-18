import mongoose from 'mongoose';

const storySchema = new mongoose.Schema({
  id: { type: String, required: true },
  headline: { type: String, required: true },
  category: { type: String, required: true },
  stance: { type: String, default: 'Neutral' },
  importance: { type: String, enum: ['lead', 'major', 'minor'], default: 'minor' },
  summary: { type: String, required: true },
  sources: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String, enum: ['YOUTUBE', 'BLOG', 'NEWSLETTER'] }
  }],
  imageUrl: {
    type: String,
    default: null
  },
  timestamp: { type: Date, default: Date.now }
});

const editionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  editionNumber: { type: Number, required: true }, // 1, 2, 3... sequence for this specific date
  dateString: { type: String, required: true, index: true }, // "YYYY-MM-DD" in local/UTC format
  stories: [storySchema],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Edition', editionSchema);

