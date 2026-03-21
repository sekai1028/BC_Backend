import mongoose from 'mongoose'
import LeaderboardEntry from '../models/LeaderboardEntry.js'
import User from '../models/User.js'

/**
 * Upsert leaderboard entry for a registered user (call after fold).
 * Uses totalSiphoned = total profit from folds for ranking.
 */
export async function upsertUserEntry(userId, displayName, profit, biggestExtract, lossOptional) {
  const entry = await LeaderboardEntry.findOne({ source: 'user', userId })
  const newTotal = (entry?.totalSiphoned ?? 0) + (Number(profit) || 0)
  const newBiggest = Math.max(entry?.biggestExtract ?? 0, Number(biggestExtract) || 0)
  const newBiggestLoss = lossOptional != null
    ? Math.max(entry?.biggestLoss ?? 0, Number(lossOptional) || 0)
    : (entry?.biggestLoss ?? 0)
  await LeaderboardEntry.findOneAndUpdate(
    { source: 'user', userId },
    {
      source: 'user',
      userId,
      displayName: displayName || 'Exile',
      totalSiphoned: newTotal,
      biggestExtract: newBiggest,
      biggestLoss: newBiggestLoss,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  )
}

/**
 * Upsert leaderboard entry for a guest (call from POST /api/leaderboard/guest-submit).
 */
export async function upsertGuestEntry(guestId, displayName, profit, biggestExtract, lossOptional) {
  if (!guestId || typeof guestId !== 'string' || guestId.length > 128) return null
  const entry = await LeaderboardEntry.findOne({ source: 'guest', guestId })
  const addProfit = Number(profit) || 0
  const newTotal = (entry?.totalSiphoned ?? 0) + addProfit
  const newBiggest = Math.max(entry?.biggestExtract ?? 0, Number(biggestExtract) || 0)
  const newBiggestLoss = lossOptional != null
    ? Math.max(entry?.biggestLoss ?? 0, Number(lossOptional) || 0)
    : (entry?.biggestLoss ?? 0)
  const updated = await LeaderboardEntry.findOneAndUpdate(
    { source: 'guest', guestId },
    {
      source: 'guest',
      guestId,
      displayName: (displayName || 'Exile').trim().slice(0, 32),
      totalSiphoned: newTotal,
      biggestExtract: newBiggest,
      biggestLoss: newBiggestLoss,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  )
  return updated
}

const SORT_FIELDS = ['totalSiphoned', 'biggestExtract', 'biggestLoss']

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find all leaderboard rows whose displayName matches (case-insensitive exact trim).
 * Returns ranked rows for the active sort column (same ranking rules as top list).
 */
export async function searchByDisplayName(query, sortBy = 'biggestExtract') {
  const q = (query || '').trim()
  if (!q || q.length > 64) return []
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : 'totalSiphoned'
  const regex = new RegExp(`^${escapeRegex(q)}$`, 'i')
  const matches = await LeaderboardEntry.find({ displayName: regex }).lean()
  const userIds = matches.filter((e) => e.source === 'user' && e.userId).map((e) => e.userId)
  const userMetaById = new Map()
  if (userIds.length > 0) {
    const users = await User.find({ _id: { $in: userIds } }).select('rank leaderboardBunkerTag leaderboardGlowColor').lean()
    for (const u of users) {
      userMetaById.set(u._id.toString(), {
        exileRank: u.rank ?? 0,
        leaderboardBunkerTag: !!u.leaderboardBunkerTag,
        leaderboardGlowColor: u.leaderboardGlowColor || '#00FF41'
      })
    }
  }
  const results = []
  for (const entry of matches) {
    const value = entry[field] ?? 0
    const above = await LeaderboardEntry.countDocuments({ [field]: { $gt: value } })
    const meta = entry.source === 'user' && entry.userId ? userMetaById.get(entry.userId.toString()) : null
    results.push({
      rank: above + 1,
      displayName: entry.displayName,
      totalSiphoned: entry.totalSiphoned ?? 0,
      biggestExtract: entry.biggestExtract ?? 0,
      biggestLoss: entry.biggestLoss ?? 0,
      source: entry.source,
      exileRank: meta ? meta.exileRank : null,
      leaderboardBunkerTag: meta?.leaderboardBunkerTag ?? false,
      leaderboardGlowColor: meta?.leaderboardGlowColor ?? null
    })
  }
  results.sort((a, b) => a.rank - b.rank || a.displayName.localeCompare(b.displayName))
  return results
}

/**
 * Get rank (1-based) and stats for a user. Returns null if no entry.
 * sortBy: 'totalSiphoned' | 'biggestExtract' | 'biggestLoss' — rank is computed by that field (default totalSiphoned).
 */
export async function getRankByUserId(userId, sortBy = 'totalSiphoned') {
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : 'totalSiphoned'
  if (!userId) return null
  const uid = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId
  const entry = await LeaderboardEntry.findOne({ source: 'user', userId: uid })
  if (!entry) return null
  const value = entry[field] ?? (field === 'biggestLoss' ? 0 : 0)
  const above = await LeaderboardEntry.countDocuments({ [field]: { $gt: value } })
  return {
    rank: above + 1,
    totalSiphoned: entry.totalSiphoned,
    biggestExtract: entry.biggestExtract,
    biggestLoss: entry.biggestLoss ?? 0,
    displayName: entry.displayName
  }
}

/**
 * Get rank (1-based) and stats for a guest. Returns null if no entry.
 * sortBy: same as getRankByUserId.
 */
export async function getRankByGuestId(guestId, sortBy = 'totalSiphoned') {
  if (!guestId) return null
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : 'totalSiphoned'
  const entry = await LeaderboardEntry.findOne({ source: 'guest', guestId })
  if (!entry) return null
  const value = entry[field] ?? (field === 'biggestLoss' ? 0 : 0)
  const above = await LeaderboardEntry.countDocuments({ [field]: { $gt: value } })
  return {
    rank: above + 1,
    totalSiphoned: entry.totalSiphoned,
    biggestExtract: entry.biggestExtract,
    biggestLoss: entry.biggestLoss ?? 0,
    displayName: entry.displayName
  }
}

/**
 * Get total number of players on the leaderboard (for "among X players").
 */
export async function getTotalPlayers() {
  return LeaderboardEntry.countDocuments()
}

/**
 * Compute 1-based rank by totalSiphoned (how many entries are strictly above this value).
 * Used when user has no LeaderboardEntry but has totalSiphoned on User (e.g. played as guest then logged in).
 */
export async function getRankByTotalSiphoned(totalSiphoned, sortBy = 'totalSiphoned') {
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : 'totalSiphoned'
  const value = Number(totalSiphoned) || 0
  const above = await LeaderboardEntry.countDocuments({ [field]: { $gt: value } })
  return above + 1
}

/**
 * Find a leaderboard entry (any source) by displayName. Used as fallback when user has no
 * source:'user' entry but has a row under the same name (e.g. played as guest then logged in).
 * Returns { totalSiphoned, biggestExtract, rank } or null.
 */
export async function getEntryByDisplayName(displayName, sortBy = 'totalSiphoned') {
  if (!displayName || typeof displayName !== 'string') return null
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : 'totalSiphoned'
  const entry = await LeaderboardEntry.findOne({ displayName: displayName.trim() })
    .sort({ [field]: -1 })
    .lean()
  if (!entry) return null
  const value = entry[field] ?? (field === 'biggestLoss' ? 0 : 0)
  const above = await LeaderboardEntry.countDocuments({ [field]: { $gt: value } })
  return {
    totalSiphoned: entry.totalSiphoned ?? 0,
    biggestExtract: entry.biggestExtract ?? 0,
    rank: above + 1,
    displayName: entry.displayName
  }
}

/** Record loss for graveyard (most gold lost in a single run). Call from gameEngine on crash. */
export async function recordUserLoss(userId, displayName, loss) {
  const amount = Number(loss) || 0
  if (amount <= 0) return
  const entry = await LeaderboardEntry.findOne({ source: 'user', userId })
  const newBiggestLoss = Math.max(entry?.biggestLoss ?? 0, amount)
  await LeaderboardEntry.findOneAndUpdate(
    { source: 'user', userId },
    {
      source: 'user',
      userId,
      displayName: displayName || 'Exile',
      totalSiphoned: entry?.totalSiphoned ?? 0,
      biggestExtract: entry?.biggestExtract ?? 0,
      biggestLoss: newBiggestLoss,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  )
}

/**
 * Get top N entries with pagination. sortBy: 'totalSiphoned' | 'biggestExtract' | 'biggestLoss' (graveyard).
 * page is 1-based; rank is global position (e.g. page 2 limit 10 → ranks 11–20).
 */
export async function getTop(limit = 50, sortBy = 'totalSiphoned', page = 1) {
  const field = sortBy === 'biggestLoss' ? 'biggestLoss' : sortBy === 'biggestExtract' ? 'biggestExtract' : 'totalSiphoned'
  const numLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const numPage = Math.max(Number(page) || 1, 1)
  const skip = (numPage - 1) * numLimit
  const entries = await LeaderboardEntry.find()
    .sort({ [field]: -1 })
    .skip(skip)
    .limit(numLimit)
    .lean()
  const userIds = entries.filter((e) => e.source === 'user' && e.userId).map((e) => e.userId)
  const userMetaById = new Map()
  if (userIds.length > 0) {
    const users = await User.find({ _id: { $in: userIds } }).select('rank leaderboardBunkerTag leaderboardGlowColor').lean()
    for (const u of users) {
      userMetaById.set(u._id.toString(), {
        exileRank: u.rank ?? 0,
        leaderboardBunkerTag: !!u.leaderboardBunkerTag,
        leaderboardGlowColor: u.leaderboardGlowColor || '#00FF41'
      })
    }
  }
  return entries.map((e, i) => {
    const meta = e.source === 'user' && e.userId ? userMetaById.get(e.userId.toString()) : null
    return {
      rank: skip + i + 1,
      displayName: e.displayName,
      totalSiphoned: e.totalSiphoned,
      biggestExtract: e.biggestExtract,
      biggestLoss: e.biggestLoss ?? 0,
      source: e.source,
      exileRank: meta ? meta.exileRank : null,
      leaderboardBunkerTag: meta?.leaderboardBunkerTag ?? false,
      leaderboardGlowColor: meta?.leaderboardGlowColor ?? null
    }
  })
}
