import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import User from '../models/User.js'
import { sendVerificationEmail, sendLoginCodeEmail } from '../services/emailService.js'
import { requireAuth } from '../middleware/auth.js'
import { getRankFromXP } from '../utils/rankFromXP.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'bunker-dev-secret-change-in-production'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

function toClientUser(doc) {
  if (!doc) return null
  const totalRounds = doc.totalRounds ?? 0
  const roundsWon = doc.roundsWon ?? 0
  const bestStreak = doc.bestStreak ?? 0
  const totalMultiplierSum = doc.totalMultiplierSum ?? 0
  const winRate = totalRounds > 0 ? (roundsWon / totalRounds) * 100 : 0
  const avgMultiplier = roundsWon > 0 ? totalMultiplierSum / roundsWon : 0
  return {
    id: doc._id.toString(),
    username: doc.username || doc.email?.split('@')[0] || 'Exile',
    email: doc.email,
    rank: doc.rank ?? 0,
    xp: doc.xp ?? doc.totalWagered ?? 0,
    totalWagered: doc.totalWagered ?? doc.xp ?? 0,
    verified: !!doc.verified,
    gold: doc.gold ?? 0,
    metal: doc.metal ?? 0,
    twoFactorEnabled: !!doc.twoFactorEnabled,
    totalRounds,
    bestStreak,
    winRate,
    avgMultiplier,
    totalSiphoned: doc.totalSiphoned ?? 0,
    biggestExtract: doc.biggestExtract ?? 0,
    achievements: Array.isArray(doc.achievements) ? doc.achievements : [],
    wagerCap: doc.wagerCap ?? 1,
    vaultLevel: doc.vaultLevel ?? 1,
    oracleLevel: doc.oracleLevel ?? 1,
    metalMod: doc.metalMod ?? 0,
    oracleMod: doc.oracleMod ?? 0,
    bannedFromChat: !!doc.bannedFromChat
  }
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, guestGold, guestTotalWagered } = req.body || {}
    const u = (username || '').trim()
    const e = (email || '').trim().toLowerCase()
    const p = password

    console.log('[auth] register attempt', { username: u, email: e })

    if (!u || u.length < 2) {
      console.log('[auth] register rejected: username too short')
      return res.status(400).json({ message: 'Username must be at least 2 characters' })
    }
    if (!e) {
      console.log('[auth] register rejected: email missing')
      return res.status(400).json({ message: 'Email is required' })
    }
    if (!p || p.length < 6) {
      console.log('[auth] register rejected: password too short')
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }

    const existing = await User.findOne({ $or: [{ username: u }, { email: e }] })
    if (existing) {
      console.log('[auth] register rejected: duplicate', { username: u, email: e })
      return res.status(400).json({
        message: existing.username === u ? 'Username already taken' : 'Email already registered'
      })
    }

    const hashed = await bcrypt.hash(p, 10)
    const verificationCode = String(100000 + Math.floor(Math.random() * 900000))
    const verificationCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000)

    // GDD 2.8.3: Guest-to-member migration — apply guest session gold/XP when provided
    const rawGuestGold = Number(guestGold)
    const rawGuestWagered = Number(guestTotalWagered)
    const hasGuestGold = Number.isFinite(rawGuestGold) && rawGuestGold >= 10
    const hasGuestWagered = Number.isFinite(rawGuestWagered) && rawGuestWagered >= 0
    const migratedGold = hasGuestGold ? Math.min(rawGuestGold, 100000) : 10.0
    const migratedTotalWagered = hasGuestWagered ? Math.min(rawGuestWagered, 1000000) : 0
    const migratedXp = migratedTotalWagered
    const migratedRank = getRankFromXP(migratedXp)

    const user = await User.create({
      username: u,
      email: e,
      password: hashed,
      verified: false,
      verificationCode,
      verificationCodeExpiresAt,
      rank: migratedRank,
      xp: migratedXp,
      totalWagered: migratedTotalWagered,
      gold: migratedGold,
      metal: 0,
      wagerCap: 2,  // GDD 8: Vault Level 1 default
      oracleLevel: 1,
      vaultLevel: 1,
      totalSiphoned: 0,
      biggestExtract: 0,
    })

    const verifyToken = jwt.sign(
      { userId: user._id.toString(), purpose: 'email-verify' },
      JWT_SECRET,
      { expiresIn: '15m' }
    )
    const verifyLink = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(verifyToken)}`

    try {
      const emailResult = await sendVerificationEmail(e, { verifyLink, code: verificationCode })
      if (!emailResult.sent) {
        await User.findByIdAndDelete(user._id)
        console.log('[auth] register rolled back: email not sent', { userId: user._id.toString() })
        return res.status(503).json({ message: 'Verification email could not be sent. Please try again later.' })
      }
    } catch (emailErr) {
      await User.findByIdAndDelete(user._id)
      console.error('[auth] register rolled back: email send failed', emailErr.message, { userId: user._id.toString() })
      return res.status(503).json({
        message: emailErr.message || 'Verification email could not be sent. Please try again later.'
      })
    }

    console.log('[auth] register success', { userId: user._id.toString(), username: u, email: e, emailSent: true })
    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      user: toClientUser(user),
      requiresVerification: true
    })
  } catch (err) {
    if (err.code === 11000) {
      console.log('[auth] register rejected: duplicate (unique index)', { message: err.message })
      return res.status(400).json({ message: 'Username or email already taken' })
    }
    console.error('[auth] register error', err.message)
    res.status(500).json({ message: err.message || 'Registration failed' })
  }
})

// Login (username or email + password)
router.post('/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body || {}
    const input = (usernameOrEmail || '').trim()
    const p = password

    console.log('[auth] login attempt', { input: input.replace(/@.*/, '@***') })

    if (!input || !p) {
      console.log('[auth] login rejected: missing credentials')
      return res.status(400).json({ message: 'Username/email and password required' })
    }

    const isEmail = input.includes('@')
    const query = isEmail ? { email: input.toLowerCase() } : { username: input }
    const user = await User.findOne(query).select('+password +twoFactorEnabled +twoFactorSecret')
    if (!user || !user.password) {
      console.log('[auth] login rejected: user not found or no password', { input: input.replace(/@.*/, '@***') })
      return res.status(401).json({ message: 'Invalid username/email or password' })
    }

    const ok = await bcrypt.compare(p, user.password)
    if (!ok) {
      console.log('[auth] login rejected: wrong password', { userId: user._id.toString() })
      return res.status(401).json({ message: 'Invalid username/email or password' })
    }

    if (!user.verified) {
      console.log('[auth] login rejected: email not verified', { userId: user._id.toString(), email: user.email })
      return res.status(403).json({
        message: 'Please verify your email before logging in. Check your inbox for the verification code.'
      })
    }

    if (user.twoFactorEnabled) {
      const tempToken = jwt.sign(
        { userId: user._id.toString(), purpose: '2fa-pending' },
        JWT_SECRET,
        { expiresIn: '5m' }
      )
      console.log('[auth] login requires 2FA', { userId: user._id.toString() })
      return res.json({ requiresTwoFactor: true, tempToken })
    }

    user.lastSeen = new Date()
    await user.save({ validateBeforeSave: false })

    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    console.log('[auth] login success', { userId: user._id.toString(), username: user.username })
    res.json({ user: toClientUser(user), token })
  } catch (err) {
    console.error('[auth] login error', err.message)
    res.status(500).json({ message: err.message || 'Login failed' })
  }
})

// --- Passwordless (Slack-style): email only, code sent to email ---

const BUNKER_PREFIXES = ['Exile', 'Siphon', 'Ghost', 'Vault', 'Oracle', 'Shadow', 'Uplink', 'Trace', 'Exile']
const BUNKER_SUFFIXES = ['_99', '_07', '_42', '_13', '_00', '_66', '_bunker', '_sys']

function generateBunkerUsername() {
  const pre = BUNKER_PREFIXES[Math.floor(Math.random() * BUNKER_PREFIXES.length)]
  const suf = BUNKER_SUFFIXES[Math.floor(Math.random() * BUNKER_SUFFIXES.length)]
  const num = Math.floor(Math.random() * 100)
  return `${pre}${suf}${num}`
}

async function ensureUniqueBunkerUsername() {
  for (let i = 0; i < 20; i++) {
    const candidate = generateBunkerUsername()
    const exists = await User.findOne({ username: candidate })
    if (!exists) return candidate
  }
  return `Exile_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`
}

/** POST /api/auth/send-login-code — Body: { email [, guestGold, guestTotalWagered ] } */
router.post('/send-login-code', async (req, res) => {
  try {
    const { email, guestGold, guestTotalWagered } = req.body || {}
    const e = (email || '').trim().toLowerCase()
    if (!e || !e.includes('@')) {
      return res.status(400).json({ message: 'A valid email is required' })
    }
    const code = String(100000 + Math.floor(Math.random() * 900000))
    const verificationCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
    let user = await User.findOne({ email: e }).select('+verificationCode +verificationCodeExpiresAt')
    if (user) {
      user.verificationCode = code
      user.verificationCodeExpiresAt = verificationCodeExpiresAt
      await user.save({ validateBeforeSave: false })
      console.log('[auth] send-login-code existing user', { userId: user._id.toString(), email: e.replace(/(.{2}).*@/, '$1***@') })
    } else {
      const username = await ensureUniqueBunkerUsername()
      const rawGuestGold = Number(guestGold)
      const rawGuestWagered = Number(guestTotalWagered)
      const hasGuestGold = Number.isFinite(rawGuestGold) && rawGuestGold >= 10
      const hasGuestWagered = Number.isFinite(rawGuestWagered) && rawGuestWagered >= 0
      const migratedGold = hasGuestGold ? Math.min(rawGuestGold, 100000) : 10.0
      const migratedTotalWagered = hasGuestWagered ? Math.min(rawGuestWagered, 1000000) : 0
      const migratedXp = migratedTotalWagered
      const migratedRank = getRankFromXP(migratedXp)
      user = await User.create({
        username,
        email: e,
        verified: false,
        verificationCode: code,
        verificationCodeExpiresAt,
        rank: migratedRank,
        xp: migratedXp,
        totalWagered: migratedTotalWagered,
        gold: migratedGold,
        metal: 0,
        wagerCap: 2,
        oracleLevel: 1,
        vaultLevel: 1,
        totalSiphoned: 0,
        biggestExtract: 0,
      })
      console.log('[auth] send-login-code new user', { userId: user._id.toString(), username, email: e.replace(/(.{2}).*@/, '$1***@') })
    }
    try {
      const magicToken = jwt.sign(
        { email: e, code, purpose: 'magic-login' },
        JWT_SECRET,
        { expiresIn: '15m' }
      )
      const magicLink = `${FRONTEND_URL}/login?magic=${encodeURIComponent(magicToken)}`
      const result = await sendLoginCodeEmail(e, code, magicLink)
      if (!result.sent) {
        return res.status(503).json({ message: 'Could not send the code. Please try again later or check email configuration.' })
      }
    } catch (emailErr) {
      console.error('[auth] send-login-code email failed', emailErr.message)
      return res.status(503).json({ message: 'Could not send the code. Please try again later.' })
    }
    res.json({ sent: true, message: 'Check your email for the login code.' })
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Username or email conflict. Try again.' })
    console.error('[auth] send-login-code error', err.message)
    res.status(500).json({ message: err.message || 'Failed to send code' })
  }
})

/** POST /api/auth/login-by-magic-link — Body: { token } — one-click login from email link */
router.post('/login-by-magic-link', async (req, res) => {
  try {
    const { token } = req.body || {}
    if (!token) return res.status(400).json({ message: 'Token required' })
    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch {
      return res.status(400).json({ message: 'Link expired or invalid. Request a new code.' })
    }
    if (decoded.purpose !== 'magic-login' || !decoded.email || !decoded.code) {
      return res.status(400).json({ message: 'Invalid link' })
    }
    const e = decoded.email.toLowerCase()
    const user = await User.findOne({ email: e }).select('+verificationCode +verificationCodeExpiresAt')
    if (!user) return res.status(400).json({ message: 'Account not found. Request a new code.' })
    if (!user.verificationCode || !user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'Code already used. Request a new code.' })
    }
    if (new Date() > user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'Link expired. Request a new code.' })
    }
    if (user.verificationCode !== decoded.code) return res.status(401).json({ message: 'Invalid link' })
    user.verified = true
    user.verificationCode = undefined
    user.verificationCodeExpiresAt = undefined
    user.lastSeen = new Date()
    await user.save({ validateBeforeSave: false })
    const sessionToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    console.log('[auth] login-by-magic-link success', { userId: user._id.toString(), username: user.username })
    res.json({ user: toClientUser(user), token: sessionToken })
  } catch (err) {
    console.error('[auth] login-by-magic-link error', err.message)
    res.status(500).json({ message: err.message || 'Login failed' })
  }
})

/** POST /api/auth/verify-login-code — Body: { email, code } */
router.post('/verify-login-code', async (req, res) => {
  try {
    const { email, code } = req.body || {}
    const e = (email || '').trim().toLowerCase()
    const c = (code || '').trim().replace(/\s/g, '')
    if (!e) return res.status(400).json({ message: 'Email is required' })
    if (!c || c.length !== 6) return res.status(400).json({ message: 'Please enter the 6-digit code from your email' })
    const user = await User.findOne({ email: e }).select('+verificationCode +verificationCodeExpiresAt')
    if (!user) return res.status(400).json({ message: 'No account found for this email. Request a new code.' })
    if (!user.verificationCode || !user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'No code was sent. Request a new code.' })
    }
    if (new Date() > user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'Code expired. Request a new code.' })
    }
    if (user.verificationCode !== c) return res.status(401).json({ message: 'Invalid code' })
    user.verified = true
    user.verificationCode = undefined
    user.verificationCodeExpiresAt = undefined
    user.lastSeen = new Date()
    await user.save({ validateBeforeSave: false })
    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    console.log('[auth] verify-login-code success', { userId: user._id.toString(), username: user.username })
    res.json({ user: toClientUser(user), token })
  } catch (err) {
    console.error('[auth] verify-login-code error', err.message)
    res.status(500).json({ message: err.message || 'Verification failed' })
  }
})

// Verify email: by link token (from email click) OR by email + 6-digit code
router.post('/verify-email', async (req, res) => {
  try {
    const { token: linkToken, email, code } = req.body || {}

    // Option 1: Verify by link token (user clicked link in email)
    if (linkToken) {
      console.log('[auth] verify-email attempt by link token')
      let decoded
      try {
        decoded = jwt.verify(linkToken, JWT_SECRET)
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(400).json({ message: 'Verification link has expired. Please register again or use the code from your email.' })
        }
        return res.status(400).json({ message: 'Invalid verification link' })
      }
      if (decoded.purpose !== 'email-verify') {
        return res.status(400).json({ message: 'Invalid verification link' })
      }
      const user = await User.findById(decoded.userId)
      if (!user) return res.status(400).json({ message: 'User not found' })
      if (user.verified) {
        const authToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
        return res.json({ user: toClientUser(user), token: authToken, verified: true })
      }
      user.verified = true
      user.verificationCode = undefined
      user.verificationCodeExpiresAt = undefined
      await user.save({ validateBeforeSave: false })
      const authToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
      console.log('[auth] verify-email success (link)', { userId: user._id.toString() })
      return res.json({ user: toClientUser(user), token: authToken, verified: true })
    }

    // Option 2: Verify by email + 6-digit code
    const e = (email || '').trim().toLowerCase()
    const c = (code || '').trim().replace(/\s/g, '')
    console.log('[auth] verify-email attempt by code', { email: e ? `${e.slice(0, 3)}***` : '(none)' })
    if (!e) return res.status(400).json({ message: 'Email is required' })
    if (!c || c.length !== 6) return res.status(400).json({ message: 'Please enter the 6-digit code from your email' })

    const user = await User.findOne({ email: e }).select('+verificationCode +verificationCodeExpiresAt')
    if (!user) return res.status(400).json({ message: 'No account found for this email' })
    if (user.verified) {
      const authToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
      return res.json({ user: toClientUser(user), token: authToken, verified: true })
    }
    if (!user.verificationCode || !user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'No verification code was sent. Please register again or use the link from your email.' })
    }
    if (new Date() > user.verificationCodeExpiresAt) {
      return res.status(400).json({ message: 'Verification code has expired. Please register again or use the link from your email.' })
    }
    if (user.verificationCode !== c) {
      return res.status(400).json({ message: 'Invalid verification code' })
    }

    user.verified = true
    user.verificationCode = undefined
    user.verificationCodeExpiresAt = undefined
    await user.save({ validateBeforeSave: false })

    const authToken = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    console.log('[auth] verify-email success (code)', { userId: user._id.toString() })
    res.json({ user: toClientUser(user), token: authToken, verified: true })
  } catch (err) {
    console.error('[auth] verify-email error', err.message)
    res.status(500).json({ message: err.message || 'Verification failed' })
  }
})

// --- Protected routes (require JWT) ---

// Get current user (profile with gold, metal, 2FA status)
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json({ user: toClientUser(req.user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Change password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password required' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' })
    }
    const user = await User.findById(req.user._id).select('+password')
    if (!user?.password) return res.status(401).json({ message: 'Invalid account' })
    const ok = await bcrypt.compare(currentPassword, user.password)
    if (!ok) return res.status(401).json({ message: 'Current password is wrong' })
    user.password = await bcrypt.hash(newPassword, 10)
    await user.save({ validateBeforeSave: false })
    console.log('[auth] password changed', { userId: user._id.toString() })
    res.json({ message: 'Password updated' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// 2FA: start setup (returns secret + QR data URL)
router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+twoFactorSecret')
    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is already enabled' })
    }
    const secret = speakeasy.generateSecret({
      name: `Bunker (${user.username || user.email || user._id})`,
      length: 20
    })
    user.twoFactorSecret = secret.base32
    await user.save({ validateBeforeSave: false })
    const qrUrl = await QRCode.toDataURL(secret.otpauth_url)
    res.json({ secret: secret.base32, qrUrl })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// 2FA: verify code and enable
router.post('/2fa/verify', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {}
    const c = (code || '').trim().replace(/\s/g, '')
    if (!c) return res.status(400).json({ message: 'Code required' })
    const user = await User.findById(req.user._id).select('+twoFactorSecret')
    if (!user.twoFactorSecret) return res.status(400).json({ message: 'Run 2FA setup first' })
    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: c,
      window: 1
    })
    if (!valid) return res.status(400).json({ message: 'Invalid code' })
    user.twoFactorEnabled = true
    await user.save({ validateBeforeSave: false })
    console.log('[auth] 2FA enabled', { userId: user._id.toString() })
    res.json({ message: '2FA enabled', user: toClientUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// 2FA: complete login with code (after password login returned requiresTwoFactor)
router.post('/2fa/login', async (req, res) => {
  try {
    const { tempToken, code } = req.body || {}
    const c = (code || '').trim().replace(/\s/g, '')
    if (!tempToken || !c) {
      return res.status(400).json({ message: 'Temporary token and code required' })
    }
    const decoded = jwt.verify(tempToken, JWT_SECRET)
    if (decoded.purpose !== '2fa-pending') {
      return res.status(400).json({ message: 'Invalid token' })
    }
    const user = await User.findById(decoded.userId).select('+twoFactorSecret')
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(401).json({ message: 'Invalid or expired. Please log in again.' })
    }
    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: c,
      window: 1
    })
    if (!valid) {
      return res.status(401).json({ message: 'Invalid code' })
    }
    user.lastSeen = new Date()
    await user.save({ validateBeforeSave: false })
    const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' })
    console.log('[auth] 2FA login success', { userId: user._id.toString() })
    res.json({ user: toClientUser(user), token })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Session expired. Please log in again.' })
    }
    res.status(500).json({ message: err.message || 'Verification failed' })
  }
})

// 2FA: disable (requires current code)
router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {}
    const c = (code || '').trim().replace(/\s/g, '')
    if (!c) return res.status(400).json({ message: 'Enter current 2FA code to disable' })
    const user = await User.findById(req.user._id).select('+twoFactorSecret')
    if (!user.twoFactorEnabled) return res.json({ message: '2FA is not enabled' })
    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: c,
      window: 1
    })
    if (!valid) return res.status(401).json({ message: 'Invalid code' })
    user.twoFactorEnabled = false
    user.twoFactorSecret = undefined
    await user.save({ validateBeforeSave: false })
    console.log('[auth] 2FA disabled', { userId: user._id.toString() })
    res.json({ message: '2FA disabled', user: toClientUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Magic link request
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body

    let user = await User.findOne({ email })
    if (!user) {
      user = await User.create({ email, verified: false })
    }

    res.json({ message: 'Magic link sent (not implemented yet)' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Verify magic link
router.get('/verify/:token', async (req, res) => {
  try {
    res.json({ message: 'Verification not implemented yet' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
