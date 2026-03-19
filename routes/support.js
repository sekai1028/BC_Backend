import express from 'express'
import rateLimit from 'express-rate-limit'
import SupportRequest from '../models/SupportRequest.js'
import { sendSupportNotification } from '../services/emailService.js'

const router = express.Router()

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

/** GDD 29: Contact form — honeypot (website), rate limit, save to DB, email to info@holdorfold.io */
router.post('/', supportLimiter, async (req, res) => {
  try {
    const { email, category, message, website } = req.body || {}
    if (website) return res.status(400).json({ error: 'Invalid request' })
    const e = (email || '').trim().toLowerCase()
    const msg = (message || '').trim()
    if (!e || !msg) return res.status(400).json({ error: 'Email and message required' })
    const errorType = (category || 'Other').slice(0, 50)
    await SupportRequest.create({
      email: e,
      category: errorType,
      message: msg.slice(0, 2000),
    })
    try {
      await sendSupportNotification({
        email: e,
        errorType,
        message: msg.slice(0, 2000),
      })
    } catch (emailErr) {
      console.error('[support] Email to info@holdorfold.io failed:', emailErr.message)
    }
    res.json({ ok: true, message: 'Request received.' })
  } catch (err) {
    console.error('[support]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
