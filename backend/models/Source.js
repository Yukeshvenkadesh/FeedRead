import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  sourceName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  sourceType: { 
    type: String, 
    required: true, 
    enum: ['YOUTUBE', 'NEWSLETTER', 'BLOG', 'RSS'],
    default: 'YOUTUBE' 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  addedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Enforce unique source subscriptions per user
sourceSchema.index({ userId: 1, sourceName: 1 }, { unique: true });

// Virtuals & toJSON transform for backwards-compatibility with frontend
sourceSchema.virtual('name').get(function () {
  return this.sourceName;
});
sourceSchema.virtual('type').get(function () {
  return this.sourceType;
});

sourceSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.name = ret.sourceName;
    ret.type = ret.sourceType;
    ret.id = ret._id;
    return ret;
  }
});

export default mongoose.model('Source', sourceSchema);
