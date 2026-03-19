import mongoose from 'mongoose'

const roundSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  wager: {
    type: Number,
    required: true
  },
  targetMultiplier: {
    type: Number,
    required: true
  },
  duration: {
    type: Number,
    required: true
  },
  finalMultiplier: {
    type: Number
  },
  folded: {
    type: Boolean,
    default: false
  },
  foldMultiplier: {
    type: Number
  },
  profit: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'folded', 'crashed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  endedAt: {
    type: Date
  }
})

export default mongoose.model('Round', roundSchema)
