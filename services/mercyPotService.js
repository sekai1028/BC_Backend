/** GDD 6: Holding Bucket — micro-contributions batched every 10s. SSC (Syndicate Siphon Credits). */
const bucket = []
let _io = null

export function addContribution(amount) {
  if (Number.isFinite(amount) && amount > 0) bucket.push(amount)
}

/** GDD 6: Rewarded Ad Watch — +$0.0040 on ad_rewarded callback. Call from siphon route. */
export function addAdContribution() {
  bucket.push(0.004)
}

/** GDD 6: Terminal +$0.0001/10s per active, Bunker +$0.0001/20s per focused → per 10s: terminal*0.0001, bunker*0.00005 */
export function addPresenceContribution(terminalActiveCount, bunkerIdleCount) {
  const t = Math.max(0, Number(terminalActiveCount) || 0)
  const b = Math.max(0, Number(bunkerIdleCount) || 0)
  if (t > 0) bucket.push(t * 0.0001)
  if (b > 0) bucket.push(b * 0.00005)
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

/** Flush bucket to DB and broadcast. GDD 6: New_Total + Global_Velocity (SSC/sec). Call every 10s with signalsDetected. */
export async function flush(signalsDetected = 0) {
  const sum = bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) : 0
  bucket.length = 0
  const velocity = sum / 10 // SSC per second
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
