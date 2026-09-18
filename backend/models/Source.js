import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    trim: true
  },
  sourceName: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['YOUTUBE', 'BLOG', 'NEWSLETTER'],
    default: 'BLOG'
  },
  sourceType: {
    type: String,
    enum: ['YOUTUBE', 'BLOG', 'NEWSLETTER'],
    default: 'BLOG'
  },
  url: {
    type: String,
    default: '',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

sourceSchema.pre('save', function (next) {
  if (!this.name && this.sourceName) this.name = this.sourceName;
  if (!this.sourceName && this.name) this.sourceName = this.name;
  if (!this.type && this.sourceType) this.type = this.sourceType;
  if (!this.sourceType && this.type) this.sourceType = this.type;
  if (this.isActive === undefined) this.isActive = true;
  next();
});

sourceSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.name = ret.name || ret.sourceName || '';
    ret.sourceName = ret.name;
    ret.type = ret.type || ret.sourceType || 'BLOG';
    ret.sourceType = ret.type;
    ret.isActive = ret.isActive !== undefined ? ret.isActive : true;
    ret.url = ret.url || '';
    ret.id = ret._id;
    return ret;
  }
});

const Source = mongoose.model('Source', sourceSchema);
export default Source;
