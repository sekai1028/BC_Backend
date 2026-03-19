import mongoose from 'mongoose'

const supportRequestSchema = new mongoose.Schema({
  email: { type: String, required: true },
  category: { type: String, default: 'Other' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('SupportRequest', supportRequestSchema)
