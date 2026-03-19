import mongoose from 'mongoose'

const chatMessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  username: {
    type: String,
    required: true
  },
  rank: {
    type: Number,
    default: 0
  },
  message: {
    type: String,
    required: true,
    maxlength: 200
  },
  standing: {
    type: Number,
    default: 0
  },
  isSystem: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

export default mongoose.model('ChatMessage', chatMessageSchema)
