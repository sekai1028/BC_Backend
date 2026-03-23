/**
 * GDD 6: Holding bucket — micro-contributions batched on the server economy interval
 * (see `SITE_ECONOMY_TICK_MS` in server.js, default 10s). SSC (Syndicate Siphon Credits).
 * Clients use `mercy-pot-update.velocity` + requestAnimationFrame to roll the display between flushes.
 */
const bucket = []
let _io = null

export function addContribution(amount) {
  if (Number.isFinite(amount) && amount > 0) bucket.push(amount)
}

/** GDD 6: Rewarded Ad Watch — +$0.0040 on ad_rewarded callback. Call from siphon route. */
export function addAdContribution() {
  bucket.push(0.004)
}

/**
 * GDD 6: Terminal +$0.0001/10s per active, Bunker +$0.0001/20s per focused → per 10s: terminal*0.0001, bunker*0.00005
 * @param {number} [intervalScale=1] — multiply when economy tick ≠ 10s (e.g. SITE_ECONOMY_TICK_MS / 10000)
 */
export function addPresenceContribution(terminalActiveCount, bunkerIdleCount, intervalScale = 1) {
  const scale = Number(intervalScale) > 0 ? intervalScale : 1
  const t = Math.max(0, Number(terminalActiveCount) || 0)
  const b = Math.max(0, Number(bunkerIdleCount) || 0)
  if (t > 0) bucket.push(t * 0.0001 * scale)
  if (b > 0) bucket.push(b * 0.00005 * scale)
}

export function start(io) {
  _io = io
}

/** Get current total from DB (for socket connection init) */
export async function getTotal() {
  try {
    const MercyPot = (await import('../models/MercyPot.js')).default
    const pot = await MercyPot.getInstance()
    return pot.total ?? 0
  } catch (e) {
    return 0
  }
}

/** Admin: set singleton Mercy Pot total (reset or manual correction). Broadcasts to clients. */
export async function setTotalAdmin(newTotal, io) {
  const t = Math.max(0, Number(newTotal) || 0)
  try {
    const MercyPot = (await import('../models/MercyPot.js')).default
    const pot = await MercyPot.getInstance()
    pot.total = t
    pot.velocity = 0
    pot.lastUpdated = new Date()
    await pot.save()
    if (io) io.emit('mercy-pot-update', { total: pot.total, velocity: 0, signalsDetected: 0 })
    return pot
  } catch (e) {
    console.warn('[mercyPotService] setTotalAdmin failed:', e?.message)
    throw e
  }
}

/**
 * Flush bucket to DB and broadcast. GDD 6: New_Total + Global_Velocity (SSC/sec).
 * @param {number} [signalsDetected=0]
 * @param {number} [bucketWindowSeconds=10] — must match server economy interval (e.g. SITE_ECONOMY_TICK_MS / 1000)
 */
export async function flush(signalsDetected = 0, bucketWindowSeconds = 10) {
  const sum = bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) : 0
  bucket.length = 0
  const winSec = Math.max(0.001, Number(bucketWindowSeconds) || 10)
  const velocity = sum / winSec // SSC per second over this bucket window
  try {
    const MercyPot = (await import('../models/MercyPot.js')).default
    const pot = await MercyPot.getInstance()
    pot.total = (pot.total || 0) + sum
    pot.velocity = velocity
    pot.lastUpdated = new Date()
    await pot.save()
    if (_io) _io.emit('mercy-pot-update', { total: pot.total, velocity, signalsDetected })
  } catch (e) {
    console.warn('[mercyPotService] flush failed:', e?.message)
  }
}

/**
 * Black Market: paid donation to global pot — apply immediately (not the 10s presence bucket).
 * @param {number} amount SSC to add (e.g. 1.0)
 * @param {number} [signalsDetected=0] optional, passed through to clients
 */
export async function addImmediateContribution(amount, signalsDetected = 0) {
  const a = Math.max(0, Number(amount) || 0)
  if (a <= 0) return null
  try {
    const MercyPot = (await import('../models/MercyPot.js')).default
    const pot = await MercyPot.getInstance()
    pot.total = (pot.total || 0) + a
    pot.lastUpdated = new Date()
    await pot.save()
    const sig = Number.isFinite(signalsDetected) ? signalsDetected : 0
    if (_io) {
      _io.emit('mercy-pot-update', {
        total: pot.total,
        velocity: pot.velocity ?? 0,
        signalsDetected: sig
      })
    }
    return pot
  } catch (e) {
    console.warn('[mercyPotService] addImmediateContribution failed:', e?.message)
    return null
  }
}
