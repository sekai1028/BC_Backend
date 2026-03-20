import express from 'express'
import {
  upsertGuestEntry,
  getRankByUserId,
  getRankByGuestId,
  getTotalPlayers,
  getTop,
  getRankByTotalSiphoned,
  getEntryByDisplayName,
  searchByDisplayName
} from '../services/leaderboardService.js'

const router = express.Router()

/**
 * POST /api/leaderboard/guest-submit
 * Submit a guest fold result (no auth). Creates/updates guest leaderboard entry.
 * Body: { guestId, displayName, profit, biggestExtract }
 * Returns: { rank, totalSiphoned, biggestExtract, totalPlayers }
 */
/** POST /api/leaderboard/guest-record-loss — record graveyard loss for guest (on crash). Body: { guestId, displayName, loss } */
router.post('/guest-record-loss', async (req, res) => {
  try {
    const { guestId, displayName, loss } = req.body || {}
    const lossNum = Number(loss) || 0
    if (!guestId || typeof guestId !== 'string' || lossNum <= 0) {
      return res.status(400).json({ message: 'guestId and positive loss required' })
    }
    await upsertGuestEntry(guestId, (displayName || 'Exile').trim().slice(0, 32), 0, 0, lossNum)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/guest-submit', async (req, res) => {
  try {
    const { guestId, displayName, profit, biggestExtract } = req.body || {}
    const entry = await upsertGuestEntry(guestId, displayName, profit, biggestExtract)
    if (!entry) {
      return res.status(400).json({ message: 'Invalid guestId' })
    }
    // Success banner shows rank by best single run (biggestExtract), not total siphoned
    const result = await getRankByGuestId(guestId, 'biggestExtract')
    const totalPlayers = await getTotalPlayers()
    res.json({
      rank: result?.rank ?? null,
      totalSiphoned: entry.totalSiphoned,
      biggestExtract: entry.biggestExtract,
      totalPlayers
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/**
 * GET /api/leaderboard/my-rank
 * Auth optional. If Authorization: Bearer token -> return rank for user.
 * If query guestId=... -> return rank for guest.
 * Query sort=totalSiphoned|biggestExtract|biggestLoss — rank is computed by that field (default totalSiphoned).
 * Returns: { rank, totalSiphoned, biggestExtract, biggestLoss, totalPlayers, displayName }
 */
router.get('/my-rank', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const guestId = req.query.guestId
    const sort = req.query.sort === 'biggestLoss' ? 'biggestLoss' : req.query.sort === 'biggestExtract' ? 'biggestExtract' : 'totalSiphoned'

    if (token && !guestId) {
      const jwt = await import('jsonwebtoken')
      const User = (await import('../models/User.js')).default
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'bunker-dev-secret-change-in-production')
      const user = await User.findById(decoded.userId)
      if (user) {
        const result = await getRankByUserId(user._id, sort)
        const totalPlayers = await getTotalPlayers()
        if (result) {
          return res.json({ ...result, totalPlayers })
        }
        // No user entry: try displayName fallback (e.g. they have a guest row with same name)
        const byName = await getEntryByDisplayName(user.username, sort)
        if (byName && (byName.totalSiphoned > 0 || (byName.biggestExtract ?? 0) > 0)) {
          return res.json({
            rank: byName.rank,
            totalSiphoned: byName.totalSiphoned,
            biggestExtract: byName.biggestExtract,
            biggestLoss: 0,
            totalPlayers,
            displayName: user.username
          })
        }
        const totalSiphoned = user.totalSiphoned ?? 0
        const computedRank = totalSiphoned > 0 ? await getRankByTotalSiphoned(totalSiphoned, sort) : null
        return res.json({
          rank: computedRank,
          totalSiphoned,
          biggestExtract: user.biggestExtract ?? 0,
          biggestLoss: 0,
          totalPlayers,
          displayName: user.username
        })
      }
    }

    if (guestId) {
      const result = await getRankByGuestId(guestId, sort)
      const totalPlayers = await getTotalPlayers()
      if (result) {
        return res.json({ ...result, totalPlayers })
      }
      return res.json({ rank: null, totalSiphoned: 0, biggestExtract: 0, biggestLoss: 0, totalPlayers, displayName: null })
    }

    const totalPlayers = await getTotalPlayers()
    res.json({ rank: null, totalSiphoned: 0, biggestExtract: 0, biggestLoss: 0, totalPlayers, displayName: null })
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      const guestId = req.query.guestId
      const sort = req.query.sort === 'biggestLoss' ? 'biggestLoss' : req.query.sort === 'biggestExtract' ? 'biggestExtract' : 'totalSiphoned'
      if (guestId) {
        const result = await getRankByGuestId(guestId, sort)
        const totalPlayers = await getTotalPlayers()
        if (result) return res.json({ ...result, totalPlayers })
      }
      const totalPlayers = await getTotalPlayers()
      return res.json({ rank: null, totalSiphoned: 0, biggestExtract: 0, biggestLoss: 0, totalPlayers, displayName: null })
    }
    res.status(500).json({ message: err.message })
  }
})

/**
 * GET /api/leaderboard/top?limit=50&page=1&sort=totalSiphoned|biggestExtract|biggestLoss
 * sort=biggestLoss = graveyard (most gold lost in a single run). page is 1-based.
 */
router.get('/top', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
    const page = Math.max(Number(req.query.page) || 1, 1)
    const q = req.query.sort
    const sort = q === 'biggestLoss' ? 'biggestLoss' : q === 'biggestExtract' ? 'biggestExtract' : 'totalSiphoned'
    const list = await getTop(limit, sort, page)
    const totalPlayers = await getTotalPlayers()
    res.json({ entries: list, totalPlayers })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/**
 * GET /api/leaderboard/search?q=name&sort=totalSiphoned|biggestExtract|biggestLoss
 * Case-insensitive exact match on displayName (paste from chat). Rank uses the same sort as the tabs.
 */
router.get('/search', async (req, res) => {
  try {
    const raw = req.query.q
    const q = typeof raw === 'string' ? raw : ''
    const sortParam = req.query.sort
    const sort = sortParam === 'biggestLoss' ? 'biggestLoss' : sortParam === 'biggestExtract' ? 'biggestExtract' : 'totalSiphoned'
    const results = await searchByDisplayName(q, sort)
    const totalPlayers = await getTotalPlayers()
    res.json({ results, totalPlayers, query: q.trim() })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
