/**
 * GDD 3.3 Automated Hero Chat Announcements — ORACLE system user, (ALERT) prefix, throttles.
 */
import { chatService } from './chatService.js'
import { getIO } from './socketIO.js'

const MAX_NAME = 28

function clipName(name) {
  const s = (name || 'Exile').toString().trim() || 'Exile'
  return s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s
}

async function emitHero(text) {
  const formatted = await chatService.broadcastHeroAnnouncement(text)
  const io = getIO()
  if (formatted && io) io.emit('chat-message', formatted)
}

/** Rank-up: per-user cooldown to reduce spam */
const rankUpLast = new Map()
const RANK_UP_MS = 90_000

/** God run: per-user cooldown */
const godRunLast = new Map()
const GOD_RUN_MS = 120_000

export async function announceNewExile(username) {
  const n = clipName(username)
  await emitHero(`(ALERT) New Exile joined the resistance: ${n}.`)
}

export async function announceRankUp(userId, username, newRank, oldRank) {
  if (newRank <= oldRank) return
  const id = String(userId)
  const now = Date.now()
  const last = rankUpLast.get(id) || 0
  if (now - last < RANK_UP_MS) return
  rankUpLast.set(id, now)
  const n = clipName(username)
  await emitHero(`(ALERT) Rank Up: ${n} reached Rank ${newRank}.`)
}

export async function announceGodRun(userId, username, multiplier) {
  const id = String(userId)
  const now = Date.now()
  const last = godRunLast.get(id) || 0
  if (now - last < GOD_RUN_MS) return
  godRunLast.set(id, now)
  const n = clipName(username)
  const m = Number(multiplier)
  const label = Number.isFinite(m) ? m.toFixed(2) : String(multiplier)
  await emitHero(`(ALERT) [GOD RUN] ${n} secured a fold at ${label}x.`)
}
