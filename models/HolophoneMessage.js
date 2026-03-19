import mongoose from 'mongoose'

/**
 * Holophone inbox messages per user. Fetched when user opens MESSAGES tab.
 */
const holophoneMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['vault', 'oracle', 'system_alert', 'encrypted', 'mission', 'market'], required: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true, trim: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true })

holophoneMessageSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('HolophoneMessage', holophoneMessageSchema)
