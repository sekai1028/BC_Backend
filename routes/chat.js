import express from 'express'
import mongoose from 'mongoose'
import { chatService } from '../services/chatService.js'
import ChatMessage from '../models/ChatMessage.js'
import ChatReport from '../models/ChatReport.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

router.get('/messages', async (req, res) => {
  try {
    const messages = await chatService.getRecentMessages()
    res.json(messages)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/** PATCH /api/chat/messages/:id — edit own message. Body: { message: string } */
router.patch('/messages/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid message id' })
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 200) : ''
    if (!message) return res.status(400).json({ error: 'message required' })
    const formatted = await chatService.updateMessage(id, req.user._id, message)
    if (!formatted) {
      return res.status(404).json({ error: 'Message not found or you can only edit your own messages' })
    }
    const io = req.app.get('io')
    if (io) io.emit('chat-message-edited', formatted)
    res.json(formatted)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** DELETE /api/chat/messages/:id — delete own message */
router.delete('/messages/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid message id' })
    }
    const deleted = await chatService.deleteMessage(id, req.user._id)
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found or you can only delete your own messages' })
    }
    const io = req.app.get('io')
    if (io) io.emit('chat-message-deleted', id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** GDD 3: Report [!] → DB + optional admin email */
router.post('/report', requireAuth, async (req, res) => {
  try {
    const { messageId, reason } = req.body || {}
    if (!messageId) return res.status(400).json({ error: 'messageId required' })
    const msg = await ChatMessage.findById(messageId)
    if (!msg) return res.status(404).json({ error: 'Message not found' })
    await ChatReport.create({
      reportedBy: req.user._id,
      messageId: msg._id,
      reportedUser: msg.userId,
      reason: (reason || '').slice(0, 200)
    })
    // Optional: set ADMIN_EMAIL in .env to receive report notifications
    const adminEmail = process.env.ADMIN_EMAIL
    if (adminEmail) {
      try {
        const { sendAdminNotification } = await import('../services/emailService.js')
        if (typeof sendAdminNotification === 'function') {
          await sendAdminNotification('Chat report', `Message ${messageId} reported by ${req.user.username}. Reason: ${reason || 'none'}`)
        }
      } catch (e) { /* ignore */ }
    }
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
