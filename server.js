import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import cors from 'cors'
import dotenv from 'dotenv'
import mongoose from 'mongoose'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import gameRoutes from './routes/game.js'
import authRoutes from './routes/auth.js'
import profileRoutes from './routes/profile.js'
import leaderboardRoutes from './routes/leaderboard.js'
import chatRoutes from './routes/chat.js'
import shopRoutes from './routes/shop.js'
import webhookRoutes, { handleStripeWebhook } from './routes/webhooks.js'
import supportRoutes from './routes/support.js'
import achievementRoutes from './routes/achievements.js'
import messageRoutes from './routes/messages.js'
import adminRoutes from './routes/admin.js'
import vaultRoutes from './routes/vault.js'
import { setIO } from './services/socketIO.js'
import { gameEngine } from './services/gameEngine.js'
import { start as mercyPotStart, getTotal as mercyPotGetTotal, flush as mercyPotFlush, addPresenceContribution as mercyPotAddPresence } from './services/mercyPotService.js'
import { chatService } from './services/chatService.js'
import { getIdleRatePer10s } from './utils/oracleLevels.js'
import User from './models/User.js'
import { getSscBalance } from './utils/sscBalance.js'
import { ensureCollections } from './scripts/initDb.js'
import { startScheduledCleanup } from './services/userCleanupService.js'

// Load .env from backend directory so STRIPE_SECRET_KEY etc. are found regardless of cwd
dotenv.config({ path: path.join(__dirname, '.env') })

// Build URI: use MONGODB_URI if set (paste from Atlas), else build from MONGODB_USER/PASSWORD/HOST/DB
function getMongoUri() {
  const uri = process.env.MONGODB_URI
  if (uri && uri.includes('mongodb')) return uri
  const user = process.env.MONGODB_USER
  const password = process.env.MONGODB_PASSWORD
  const host = process.env.MONGODB_HOST || 'cluster0.f00pu7a.mongodb.net'
  const db = process.env.MONGODB_DB || 'bunker'
  if (user && password) {
    const encoded = encodeURIComponent(password)
    return `mongodb+srv://${user}:${encoded}@${host}/${db}?retryWrites=true&w=majority&authSource=admin`
  }
  return process.env.MONGODB_URI || 'mongodb://localhost:27017/bunker'
}

const MONGODB_URI = getMongoUri()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
})
app.set('io', io)

// Middleware
app.use(cors())
// Stripe webhook needs raw body for signature verification (GDD 5.0)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => handleStripeWebhook(req, res))
app.use(express.json())

// Routes
app.use('/api/game', gameRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/leaderboard', leaderboardRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/shop', shopRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/support', supportRoutes)
app.use('/api/achievements', achievementRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/vault', vaultRoutes)

// Production: serve frontend build and SPA fallback so /admin, /play, etc. work on direct load or refresh
function findFrontendDist() {
  const hasIndex = (p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))

  if (process.env.FRONTEND_DIST) {
    const raw = process.env.FRONTEND_DIST.trim()
    const p = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw)
    if (hasIndex(p)) return p
  }

  const candidates = [
    path.resolve(__dirname, '..', 'frontend', 'dist'),
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(process.cwd(), 'frontend', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ]
  for (const p of candidates) {
    if (hasIndex(p)) return p
  }
  return null
}
const frontendDist = findFrontendDist()
if (frontendDist) {
  app.use(express.static(frontendDist, { index: false }))
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next()
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
  console.log('Serving frontend from:', frontendDist)
} else {
  const servedSeparately = (process.env.FRONTEND_SERVED_SEPARATELY || process.env.frontend_served_separately || '')
    .toLowerCase()
  if (process.env.NODE_ENV === 'production' && !['true', '1', 'yes'].includes(servedSeparately)) {
    console.warn('Frontend dist not found. /admin and other client routes will 404 on this URL. Set FRONTEND_SERVED_SEPARATELY=true if the frontend is a separate static site (then use the frontend URL for /admin, /play).')
  }
}

setIO(io)

// One shared chart for all users: idle when no round, round path when active
const GLOBAL_ROUND_ID = 'global'
let idlePath = []
let idleMultiplier = 1.0
let idleIntervalId = null

function startIdleBroadcast(io) {
  if (idleIntervalId) return
  idleIntervalId = setInterval(() => {
    if (gameEngine.activeRounds?.has?.(GLOBAL_ROUND_ID)) return
    idleMultiplier += (Math.random() - 0.5) * 0.04
    idleMultiplier = Math.max(0.95, Math.min(1.05, idleMultiplier))
    idlePath.push(idleMultiplier)
    if (idlePath.length > 300) idlePath = idlePath.slice(-300)
    io.emit('multiplier-update', { multiplier: idleMultiplier, state: 'idle', pathLength: idlePath.length })
  }, 100)
}

function stopIdleBroadcast() {
  if (idleIntervalId) {
    clearInterval(idleIntervalId)
    idleIntervalId = null
  }
}

// GDD 6.1: Presence for Mercy Pot — page: terminal|bunker, terminalActive (in round), bunkerFocused (tab focus)
const presenceBySocket = new Map()

/** Same metric as Mercy Pot `signalsDetected`: terminal/bunker presence rows, else raw client count. */
function getSignalsDetected(io) {
  let signalsDetected = 0
  presenceBySocket.forEach((p) => {
    if (p.page === 'terminal' || p.page === 'bunker') signalsDetected++
  })
  if (signalsDetected === 0) signalsDetected = io.engine?.clientsCount ?? 0
  return signalsDetected
}

function broadcastOnlineCount() {
  io.emit('online-count', getSignalsDetected(io))
}
const COOLDOWN_MS = 15 * 60 * 1000
const intensityAlertCooldown = { 3: 0, 4: 0, 5: 0 }
let lastIntensityLevel = 0

function getIntensityLevel(signals) {
  if (signals >= 51) return 5
  if (signals >= 31) return 4
  if (signals >= 16) return 3
  if (signals >= 6) return 2
  return 1
}

function maybeEmitIntensityAlert(io, level) {
  if (level < 3 || level <= lastIntensityLevel) return
  const now = Date.now()
  if (intensityAlertCooldown[level] && now - intensityAlertCooldown[level] < COOLDOWN_MS) return
  const messages = {
    3: '(ALERT) Signal Intensity rising. 20+ Exiles siphoning...',
    4: '(ALERT) EXTREME SIPHON EVENT. The Bunker is hot!',
    5: '(CRITICAL) SYNDICATE TRACE IMMINENT. HOLD THE LINE.'
  }
  const text = messages[level]
  if (text) {
    io.emit('chat-message', { id: 'intensity-' + now, username: 'Oracle', text, isSystem: true, time: 'now', rank: 0 })
    intensityAlertCooldown[level] = now
  }
  lastIntensityLevel = level
}

function runMercyPotTick(io) {
  const round = gameEngine.activeRounds?.get?.(GLOBAL_ROUND_ID)
  const terminalActiveCount = round?.participants?.size ?? 0
  let bunkerIdleCount = 0
  presenceBySocket.forEach((p) => {
    if (p.page === 'bunker' && p.bunkerFocused) bunkerIdleCount++
  })
  const signalsDetected = getSignalsDetected(io)
  mercyPotAddPresence(terminalActiveCount, bunkerIdleCount)
  mercyPotFlush(signalsDetected).then(() => {
    const level = getIntensityLevel(signalsDetected)
    maybeEmitIntensityAlert(io, level)
    lastIntensityLevel = level
  })
}

/** Master SSC clock: every 10s while user is on site (any page with presence + userId). Emits combined gold + balance. */
async function runSiteSscIdleTick(io) {
  const { SSC_PER_10S_SITE_IDLE } = await import('./config/sscConstants.js')
  const byUser = new Map()
  presenceBySocket.forEach((p, socketId) => {
    if (!p.userId) return
    if (!byUser.has(p.userId)) byUser.set(p.userId, [])
    byUser.get(p.userId).push(socketId)
  })
  for (const [userId, socketIds] of byUser) {
    try {
      const user = await User.findById(userId)
      if (!user) continue
      if (user.sscBalance == null && user.metal != null) {
        user.sscBalance = user.metal
      }
      const next = (user.sscBalance ?? user.metal ?? 0) + SSC_PER_10S_SITE_IDLE
      user.sscBalance = next
      await user.save()
      const bal = getSscBalance(user)
      const payload = {
        gold: user.gold,
        metal: bal,
        sscBalance: bal,
        user_ssc_balance: bal,
      }
      for (const sid of socketIds) {
        const s = io.sockets.sockets.get(sid)
        if (s) s.emit('oracle-idle-gold', payload)
      }
    } catch (e) {
      console.warn('[siteSscIdle]', userId, e?.message)
    }
  }
}

// GDD 8.1: Oracle idle gold tick — only when socket connected and tab focused (uplink requirement)
async function runOracleIdleTick(io) {
  const socketsByUser = new Map()
  presenceBySocket.forEach((p, socketId) => {
    if (!p.userId) return
    const focused = p.page === 'terminal' || (p.page === 'bunker' && p.bunkerFocused)
    if (!focused) return
    if (!socketsByUser.has(p.userId)) socketsByUser.set(p.userId, [])
    socketsByUser.get(p.userId).push(socketId)
  })
  for (const [userId, socketIds] of socketsByUser) {
    try {
      const user = await User.findById(userId)
      if (!user) continue
      const rate = getIdleRatePer10s(user.oracleLevel ?? 1)
      const newGold = (user.gold ?? 0) + rate
      await User.findByIdAndUpdate(userId, { $set: { gold: newGold } })
      // Gold push to client happens in runSiteSscIdleTick (combined with SSC balance)
    } catch (e) {
      console.warn('[oracleIdle] tick failed for user', userId, e?.message)
    }
  }
}

// Socket.io connection handling
io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id)
  const signals = getSignalsDetected(io)
  socket.emit('online-count', signals)
  broadcastOnlineCount()
  try {
    const total = await mercyPotGetTotal()
    socket.emit('mercy-pot-update', { total, velocity: 0, signalsDetected: signals })
  } catch (e) { /* ignore */ }

  socket.on('mercy-presence', (data) => {
    const page = (data?.page === 'bunker') ? 'bunker' : 'terminal'
    const terminalActive = !!data?.terminalActive
    const bunkerFocused = data?.bunkerFocused !== false && page === 'bunker'
    const userId = data?.userId && typeof data.userId === 'string' ? data.userId : null
    presenceBySocket.set(socket.id, { page, terminalActive, bunkerFocused, userId })
    socket.join(page)
    broadcastOnlineCount()
  })

  const globalRound = gameEngine.activeRounds?.get?.(GLOBAL_ROUND_ID)
  if (globalRound?.multiplierPath?.length) {
    socket.emit('multiplier-path-sync', {
      roundId: GLOBAL_ROUND_ID,
      path: globalRound.multiplierPath,
      currentMultiplier: globalRound.currentMultiplier
    })
  } else if (idlePath.length > 0) {
    socket.emit('multiplier-path-sync', {
      roundId: 'idle',
      path: [...idlePath],
      currentMultiplier: idleMultiplier
    })
  }

  socket.on('request-path-sync', () => {
    const rd = gameEngine.activeRounds?.get?.(GLOBAL_ROUND_ID)
    if (rd?.multiplierPath?.length) {
      socket.emit('multiplier-path-sync', {
        roundId: GLOBAL_ROUND_ID,
        path: rd.multiplierPath,
        currentMultiplier: rd.currentMultiplier
      })
    } else if (idlePath.length > 0) {
      socket.emit('multiplier-path-sync', {
        roundId: 'idle',
        path: [...idlePath],
        currentMultiplier: idleMultiplier
      })
    }
  })

  socket.on('disconnect', () => {
    gameEngine.onSocketDisconnect(socket.id)
  })

  socket.on('start-round', async (data) => {
    try {
      const { userId, wager, gold: clientGold, guestId } = data || {}
      const wagerNum = Number(wager) || 0
      const result = await gameEngine.startRound(socket.id, userId || null, wagerNum, clientGold, guestId || null)
      const round = result.round ?? result
      const isNewRound = result.isNewRound !== false
      const wagerAmount = round.wager !== undefined && round.wager > 0 ? round.wager : wagerNum
      const roundIdStr = round._id.toString()
      const payload = { roundId: roundIdStr, wager: wagerAmount, isNewRound }
      if (result.gold != null) payload.gold = result.gold
      socket.emit('round-started', payload)
      if (isNewRound) {
        stopIdleBroadcast()
        // Same chart for all users: always broadcast multiplier-update to everyone
        gameEngine.runRound(round._id, (multiplier, state, headline, pathLength, meta) => {
          const payload = { multiplier, state, pathLength, roundId: roundIdStr }
          if (headline) payload.headline = headline
          io.emit('multiplier-update', payload)
          if (state === 'crashed') {
            io.emit('round-crashed', { multiplier, pathLength })
            if (meta && meta.achievementsBySocketId && typeof meta.achievementsBySocketId === 'object') {
              for (const [sid, arr] of Object.entries(meta.achievementsBySocketId)) {
                if (Array.isArray(arr) && arr.length > 0) {
                  io.to(sid).emit('achievements-unlocked', { newAchievements: arr })
                }
              }
            }
            startIdleBroadcast(io)
          }
        })
      } else {
        const rd = gameEngine.activeRounds.get(roundIdStr)
        if (rd) {
          socket.emit('multiplier-path-sync', {
            roundId: roundIdStr,
            path: rd.multiplierPath ?? [],
            currentMultiplier: rd.currentMultiplier
          })
          socket.emit('multiplier-update', {
            multiplier: rd.currentMultiplier,
            state: 'running',
            roundId: roundIdStr,
            pathLength: (rd.multiplierPath ?? []).length
          })
        }
      }
    } catch (err) {
      socket.emit('game-error', { message: err.message || 'Failed to start round' })
    }
  })

  socket.on('resume-round', async (data) => {
    try {
      const { userId, guestId } = data || {}
      const result = await gameEngine.resumeRound(socket.id, userId || null, guestId || null)
      if (!result) return
      const payload = { roundId: result.roundId, wager: result.wager, isNewRound: false }
      if (result.gold != null) payload.gold = result.gold
      socket.emit('round-started', payload)
      socket.emit('multiplier-path-sync', {
        roundId: result.roundId,
        path: result.path,
        currentMultiplier: result.currentMultiplier
      })
      socket.emit('multiplier-update', {
        multiplier: result.currentMultiplier,
        state: 'running',
        roundId: result.roundId,
        pathLength: (result.path || []).length
      })
    } catch (err) {
      console.warn('[resume-round]', err?.message)
    }
  })

  socket.on('fold-round', async (data) => {
    try {
      const { roundId, clientMultiplier } = data || {}
      if (!roundId) {
        socket.emit('game-error', { message: 'roundId required' })
        return
      }
      const result = await gameEngine.foldRound(socket.id, roundId, clientMultiplier)
      if (result) socket.emit('round-folded', result)
      else socket.emit('game-error', { message: 'Round not found or already ended' })
    } catch (err) {
      socket.emit('game-error', { message: err.message || 'Failed to fold' })
    }
  })

  // Chat events
  socket.on('chat-message', async (data) => {
    try {
      const message = await chatService.sendMessage(data)
      io.emit('chat-message', message)
    } catch (err) {
      socket.emit('chat-error', { message: err.message || 'Failed to send' })
    }
  })

  socket.on('disconnect', () => {
    presenceBySocket.delete(socket.id)
    console.log('Client disconnected:', socket.id)
    broadcastOnlineCount()
  })
})

let mercyPotIntervalId = null
function startMercyPotTick(io) {
  if (mercyPotIntervalId) return
  mercyPotIntervalId = setInterval(() => {
    runMercyPotTick(io)
    runOracleIdleTick(io)
    runSiteSscIdleTick(io)
  }, 10000)
}

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000

async function start() {
  try {
    const safeUri = MONGODB_URI.replace(/:[^:@]+@/, ':****@')
    console.log('MongoDB connecting to:', safeUri)
    await mongoose.connect(MONGODB_URI, {
      authSource: 'admin',
      serverSelectionTimeoutMS: 10000,
    })
    console.log('MongoDB connected')
    console.log('Ensuring collections and indexes...')
    await ensureCollections()
  } catch (err) {
    console.error('MongoDB connection error:', err.message)
    console.error('Check: username, password, Network Access (Atlas), and authSource=admin')
    process.exit(1)
  }
  // Use DB for rounds by default; set MEMORY_ONLY=true for dev (shared chart, no Round docs)
  gameEngine.setMemoryOnly(process.env.MEMORY_ONLY === 'true')
  console.log('Game engine:', gameEngine.memoryOnly ? 'memory-only (shared chart)' : 'DB (per-player rounds)')
  // Remove inactive / unverified users on a schedule (USER_CLEANUP_INACTIVE_DAYS, USER_CLEANUP_UNVERIFIED_DAYS)
  startScheduledCleanup({ initialDelayMs: 60 * 1000 })
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    startIdleBroadcast(io)
    mercyPotStart(io)
    startMercyPotTick(io)
  })
}

start().catch((err) => {
  console.error('Startup error:', err)
  process.exit(1)
})
