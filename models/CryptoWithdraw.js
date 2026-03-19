import mongoose from 'mongoose'

const cryptoWithdrawSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountGold: { type: Number, required: true },
  walletAddress: { type: String, required: true },
  currency: { type: String, default: 'usdt' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'rejected'],
    default: 'pending'
  },
  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('CryptoWithdraw', cryptoWithdrawSchema)
