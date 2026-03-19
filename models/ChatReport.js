import mongoose from 'mongoose'

const chatReportSchema = new mongoose.Schema({
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('ChatReport', chatReportSchema)
