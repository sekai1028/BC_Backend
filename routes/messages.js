import express from 'express'
import HolophoneMessage from '../models/HolophoneMessage.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

const DEFAULT_MESSAGES = [
  { type: 'vault', title: 'RE: THE VAULT', body: 'Your recent extraction has been flagged…', highlight: true, alert: false },
  { type: 'oracle', title: 'ORACLE', body: 'New Lore Chapter Unlocked: The Collapse…', highlight: false, alert: false },
  { type: 'system_alert', title: 'SYSTEM ALERT', body: 'Wager Cap reached. Upgrade required.', highlight: false, alert: true },
  { type: 'encrypted', title: 'ENCRYPTED MESSAGE', body: 'Decrypt key required. Secure channel.', highlight: false, alert: false },
  { type: 'mission', title: 'MISSION UPDATE', body: 'Target located. Awaiting orders.', highlight: false, alert: false },
  { type: 'market', title: 'BLACK MARKET', body: 'New tech available for trade.', highlight: false, alert: false }
]

/**
 * GET /api/messages
 * Returns Holophone messages from MongoDB for the authenticated user.
 * If none exist, seeds defaults then returns. Auth required (same as leaderboard/profile).
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user

    // Full message history from MongoDB (newest first); no limit
    let list = await HolophoneMessage.find({ userId: user._id }).sort({ createdAt: -1 }).lean()
    if (list.length === 0) {
      await HolophoneMessage.insertMany(
        DEFAULT_MESSAGES.map((m) => ({
          userId: user._id,
          type: m.type,
          title: m.title,
          body: m.body,
          read: false
        }))
      )
      list = await HolophoneMessage.find({ userId: user._id }).sort({ createdAt: -1 }).lean()
    }

    const messages = list.map((m) => ({
      id: m._id.toString(),
      type: m.type,
      title: m.title,
      body: m.body,
      read: m.read,
      alert: m.type === 'system_alert',
      highlight: m.type === 'vault',
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null
    }))
    res.json({ messages })
  } catch (err) {
    console.error('[GET /api/messages]', err?.message || err)
    res.status(500).json({ messages: [], message: err?.message || 'Server error' })
  }
})

/**
 * POST /api/messages/:id/read
 * Mark a message as read. Auth required; message must belong to user.
 */
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    const updated = await HolophoneMessage.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: true }
    )
    if (!updated) return res.status(404).json({ message: 'Message not found' })
    res.json({ ok: true, read: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
