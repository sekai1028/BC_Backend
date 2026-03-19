/**
 * GDD 20: Admin Command Center — economy config, toggles, analytics, reset, ban.
 * All routes require X-Admin-Secret or Authorization: Bearer <ADMIN_SECRET>.
 */
import express from 'express'
import User from '../models/User.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { getEconomyConfig, setEconomyConfig, invalidateEconomyCache } from '../config/economy.js'
import { getIO } from '../services/socketIO.js'

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

/** GET /api/admin/users — list users (id, username, gold, bannedFromChat) for admin UI */
router.get('/users', async (req, res) => {
  try {
    const list = await User.find({})
      .select('username email gold rank totalSiphoned bannedFromChat createdAt')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
    res.json({ users: list.map((u) => ({ ...u, id: u._id.toString() })) })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
})

export default router
