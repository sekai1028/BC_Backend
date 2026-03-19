import mongoose from 'mongoose'

/**
 * Single leaderboard table: users and guests ranked by total profit from folds.
 * GDD 2.7.4: "Your Rank" on success banner; guests get auto-generated names and scores logged.
 */
const leaderboardEntrySchema = new mongoose.Schema({
  source: { type: String, enum: ['user', 'guest'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  guestId: { type: String, default: null },
  displayName: { type: String, required: true, trim: true },
  totalSiphoned: { type: Number, default: 0 },
  biggestExtract: { type: Number, default: 0 },
  /** Graveyard: most gold lost in a single run (crash). */
  biggestLoss: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true })

leaderboardEntrySchema.index({ totalSiphoned: -1 })
leaderboardEntrySchema.index({ biggestLoss: -1 })
leaderboardEntrySchema.index({ userId: 1 }, { sparse: true })
leaderboardEntrySchema.index({ guestId: 1 }, { sparse: true })

export default mongoose.model('LeaderboardEntry', leaderboardEntrySchema)
