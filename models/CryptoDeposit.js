import mongoose from 'mongoose'

const cryptoDepositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountGold: { type: Number, required: true },
  amountUsd: { type: Number, required: true },
  payCurrency: { type: String, default: 'usdt' },
  payAmount: { type: Number },
  payAddress: { type: String },
  orderId: { type: String, required: true, unique: true },
  providerPaymentId: { type: String },
  status: {
    type: String,
    enum: ['pending', 'completed', 'expired', 'failed'],
    default: 'pending'
  },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('CryptoDeposit', cryptoDepositSchema)
