/**
 * GDD 20: Admin Command Center — economy config, toggles, analytics, reset, ban.
 * All routes require X-Admin-Secret or Authorization: Bearer <ADMIN_SECRET>.
 */
import express from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { chatService } from '../services/chatService.js'
import { getEconomyConfig, setEconomyConfig, invalidateEconomyCache } from '../config/economy.js'
import { getIO } from '../services/socketIO.js'
import { setTotalAdmin } from '../services/mercyPotService.js'

const router = express.Router()
router.use(requireAdmin)

/** GET /api/admin/config — current economy config (no secrets) */
router.get('/config', (req, res) => {
  try {
    invalidateEconomyCache()
    res.json(getEconomyConfig())
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** PATCH /api/admin/config — update economy (partial merge). No redeploy. */
router.patch('/config', (req, res) => {
  try {
    const updated = setEconomyConfig(req.body || {})
    res.json(updated)
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** POST /api/admin/golden-rain — GDD 20: manual trigger to excite players */
router.post('/golden-rain', (req, res) => {
  const io = getIO()
  if (io) io.emit('admin-event', { type: 'golden-rain', at: new Date().toISOString() })
  res.json({ ok: true, event: 'golden-rain' })
})

/** POST /api/admin/blackout — GDD 20: manual trigger "Great Blackout" */
router.post('/blackout', (req, res) => {
  const io = getIO()
  if (io) io.emit('admin-event', { type: 'great-blackout', at: new Date().toISOString() })
  res.json({ ok: true, event: 'great-blackout' })
})

/** GET /api/admin/analytics — Average Session Time, Ad View Ratio, Gold Inflation */
router.get('/analytics', async (req, res) => {
  try {
    const users = await User.find({}).lean()
    const totalGold = users.reduce((s, u) => s + (Number(u.gold) || 0), 0)
    const totalAdsWatched = users.reduce((s, u) => s + (Number(u.adsWatched) || 0), 0)
    const totalRounds = users.reduce((s, u) => s + (Number(u.totalRounds) || 0), 0)
    const totalSecondsOnline = users.reduce((s, u) => s + (Number(u.totalSecondsOnline) || 0), 0)
    const activeUsers = users.filter((u) => u.lastSeen && (Date.now() - new Date(u.lastSeen).getTime() < 7 * 24 * 3600 * 1000)).length
    const avgSessionSeconds = activeUsers > 0 ? totalSecondsOnline / activeUsers : 0
    const adViewRatio = totalRounds > 0 ? totalAdsWatched / totalRounds : 0
    res.json({
      totalUsers: users.length,
      totalGold: Math.round(totalGold * 100) / 100,
      totalAdsWatched,
      totalRounds,
      adViewRatio: Math.round(adViewRatio * 1000) / 1000,
      totalSecondsOnline,
      avgSessionMinutes: Math.round((avgSessionSeconds / 60) * 10) / 10,
      activeUsersLast7d: activeUsers
    })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** POST /api/admin/reset-gold — Emergency reset: set a user's gold to avoid bankruptcy loop */
router.post('/reset-gold', async (req, res) => {
  try {
    const { userId, gold = 10 } = req.body || {}
    if (!userId) return res.status(400).json({ message: 'userId required' })
    const amount = Math.max(0, Number(gold))
    const user = await User.findByIdAndUpdate(userId, { $set: { gold: amount } }, { new: true })
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ ok: true, userId: user._id.toString(), gold: user.gold })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

const MAX_GIVE_GOLD = 1_000_000_000

/**
 * PATCH /api/admin/users/:id/username — force-change username (moderation).
 * Body: { username: string }
 */
router.patch('/users/:id/username', async (req, res) => {
  try {
    const { id } = req.params
    const raw = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    if (!raw || raw.length < 2 || raw.length > 32) {
      return res.status(400).json({ message: 'username must be 2–32 characters' })
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user id' })
    }
    const taken = await User.findOne({ username: raw, _id: { $ne: id } })
    if (taken) return res.status(400).json({ message: 'Username already taken' })
    const user = await User.findByIdAndUpdate(id, { $set: { username: raw } }, { new: true })
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ ok: true, userId: user._id.toString(), username: user.username })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** POST /api/admin/adjust-gold — add or remove gold (signed delta) */
router.post('/adjust-gold', async (req, res) => {
  try {
    const { userId, delta } = req.body || {}
    const d = Number(delta)
    if (!userId || !Number.isFinite(d)) {
      return res.status(400).json({ message: 'userId and delta (number) required' })
    }
    const MAX = 1_000_000_000
    if (Math.abs(d) > MAX) return res.status(400).json({ message: 'delta too large' })
    let user = await User.findByIdAndUpdate(userId, { $inc: { gold: d } }, { new: true })
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.gold < 0) {
      user = await User.findByIdAndUpdate(userId, { $set: { gold: 0 } }, { new: true })
    }
    res.json({ ok: true, userId: user._id.toString(), gold: user.gold, delta: d })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** PATCH /api/admin/mercy-pot — set global mercy pot total or reset to 0 */
router.patch('/mercy-pot', async (req, res) => {
  try {
    const { total, reset } = req.body || {}
    const io = getIO()
    if (reset === true) {
      await setTotalAdmin(0, io)
      return res.json({ ok: true, total: 0 })
    }
    const t = Number(total)
    if (!Number.isFinite(t) || t < 0) {
      return res.status(400).json({ message: 'total must be a non-negative number, or use reset: true' })
    }
    await setTotalAdmin(t, io)
    res.json({ ok: true, total: t })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** POST /api/admin/give-gold — add gold to a user (positive increment only) */
router.post('/give-gold', async (req, res) => {
  try {
    const { userId, amount } = req.body || {}
    if (!userId) return res.status(400).json({ message: 'userId required' })
    const add = Number(amount)
    if (!Number.isFinite(add) || add <= 0) {
      return res.status(400).json({ message: 'amount must be a positive number' })
    }
    if (add > MAX_GIVE_GOLD) {
      return res.status(400).json({ message: `amount too large (max ${MAX_GIVE_GOLD})` })
    }
    const user = await User.findByIdAndUpdate(userId, { $inc: { gold: add } }, { new: true })
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ ok: true, userId: user._id.toString(), gold: user.gold, given: add })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** POST /api/admin/ban-chat — Ban user from Global Chat */
router.post('/ban-chat', async (req, res) => {
  try {
    const { userId, banned = true } = req.body || {}
    if (!userId) return res.status(400).json({ message: 'userId required' })
    const user = await User.findByIdAndUpdate(userId, { $set: { bannedFromChat: !!banned } }, { new: true })
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ ok: true, userId: user._id.toString(), bannedFromChat: user.bannedFromChat })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/**
 * GET /api/admin/users — list users for admin UI.
 * Optional ?q= — search username / email (substring, case-insensitive) or exact MongoDB ObjectId.
 * Optional ?limit= — default 500 (no q) or 100 (with q), max 500.
 */
router.get('/users', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const defaultLimit = q ? 100 : 500
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || defaultLimit))

    let mongoQuery = {}
    if (q) {
      const hex24 = /^[a-fA-F0-9]{24}$/
      if (hex24.test(q) && mongoose.Types.ObjectId.isValid(q)) {
        mongoQuery = { _id: new mongoose.Types.ObjectId(q) }
      } else {
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        mongoQuery = {
          $or: [
            { username: { $regex: esc, $options: 'i' } },
            { email: { $regex: esc, $options: 'i' } },
          ],
        }
      }
    }

    const list = await User.find(mongoQuery)
      .select('username email gold rank totalSiphoned bannedFromChat createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
    res.json({ users: list.map((u) => ({ ...u, id: u._id.toString() })) })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** GET /api/admin/chat/messages — recent Global Chat for moderation */
router.get('/chat/messages', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    const messages = await chatService.getRecentMessages(limit)
    res.json({ messages })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

/** DELETE /api/admin/chat/messages/:id — remove any message (broadcasts to clients) */
router.delete('/chat/messages/:id', async (req, res) => {
  try {
    const id = req.params.id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid message id' })
    }
    const deleted = await chatService.deleteMessageAdmin(id)
    if (!deleted) {
      return res.status(404).json({ message: 'Message not found' })
    }
    const io = getIO()
    if (io) io.emit('chat-message-deleted', id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

export default router
