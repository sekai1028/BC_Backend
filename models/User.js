import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    sparse: true
  },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    default: () => `Exile_${Math.floor(Math.random() * 10000)}`
  },
  password: {
    type: String,
    select: false
  },
  rank: {
    type: Number,
    default: 0
  },
  xp: {
    type: Number,
    default: 0
  },
  /** Total gold wagered (1 gold = 1 XP); used to compute rank */
  totalWagered: {
    type: Number,
    default: 0
  },
  gold: {
    type: Number,
    default: 10.0
  },
  metal: {
    type: Number,
    default: 0
  },
  /** Single SSC wallet — idle + ads + shop; legacy `metal` merged on read if unset */
  sscBalance: {
    type: Number,
    default: 0
  },
  /** @deprecated Lifetime counter — prefer sscBalance for display */
  sscEarned: {
    type: Number,
    default: 0
  },
  /** Black Market: doubles video ad SSC grant */
  propagandaFilter: { type: Boolean, default: false },
  /** Black Market: leaderboard name outline glow */
  leaderboardBunkerTag: { type: Boolean, default: false },
  leaderboardGlowColor: { type: String, default: '#00FF41' },
  verified: {
    type: Boolean,
    default: false
  },
  verificationCode: {
    type: String,
    default: null,
    select: false
  },
  verificationCodeExpiresAt: {
    type: Date,
    default: null,
    select: false
  },
  wagerCap: {
    type: Number,
    default: 2  // GDD 8: Vault Level 1 = 2 Gold (Trading License default)
  },
  oracleLevel: {
    type: Number,
    default: 1
  },
  vaultLevel: {
    type: Number,
    default: 1
  },
  /** GDD 5.1: Shop permanent boosts — best-in-slot, additive to base 1.0. Max metalMod +2, oracleMod +1. */
  metalMod: { type: Number, default: 0 },
  oracleMod: { type: Number, default: 0 },
  achievements: [{
    type: String
  }],
  totalSiphoned: {
    type: Number,
    default: 0
  },
  biggestExtract: {
    type: Number,
    default: 0
  },
  totalRounds: { type: Number, default: 0 },
  roundsWon: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 },
  currentStreak: { type: Number, default: 0 },
  totalMultiplierSum: { type: Number, default: 0 },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  twoFactorSecret: {
    type: String,
    default: null,
    select: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  usernameChangeCount: {
    type: Number,
    default: 0
  },
  /** Coupon codes already redeemed by this user (one-time per user). */
  redeemedCoupons: [{ type: String }],
  /** GDD 20: Admin — ban from Global Chat */
  bannedFromChat: { type: Boolean, default: false },
  /** GDD 19: Achievement tracking */
  adsWatched: { type: Number, default: 0 },
  timesCrashed: { type: Number, default: 0 },
  timesBankrupt: { type: Number, default: 0 },
  maxMultiplierReached: { type: Number, default: 1 },
  totalSecondsOnline: { type: Number, default: 0 },
  bestConsecutiveMaxWager: { type: Number, default: 0 },
  currentConsecutiveMaxWager: { type: Number, default: 0 },
  mercyDonatedWithoutGold: { type: Number, default: 0 },
  recoveredTo1WithoutBuying: { type: Boolean, default: false },
  sessionStartedAt: { type: Date, default: null },
  /** Legendary Syndicate Slayer — completed Enter the Vault (SSC deposit + milestones) */
  vaultLegendUnlocked: { type: Boolean, default: false }
})

export default mongoose.model('User', userSchema)
