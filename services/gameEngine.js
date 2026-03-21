import { getRankFromXP } from '../utils/rankFromXP.js'
import { addContribution as mercyPotAdd } from './mercyPotService.js'
import { checkAndUnlock } from './achievementService.js'
import { getCeiling, getFloor } from '../utils/oracleLevels.js'
import { getHeadlineForTier } from '../config/headlinePools.js'
import { SSC_PER_SECOND_ROUND } from '../config/sscConstants.js'
import { getSscBalance } from '../utils/sscBalance.js'

const GLOBAL_ROUND_ID = 'global'

/**
 * Report-only SSC for round banner — idle loop is the master clock; do not credit twice.
 * Elapsed = fold time − round join (createdAt), capped by round duration (ms).
 */
function computeSscReportForRound(roundDoc) {
  if (!roundDoc) return 0
  const created = roundDoc.createdAt ? new Date(roundDoc.createdAt).getTime() : Date.now()
  const elapsedMs = Date.now() - created
  const durMs = roundDoc.duration != null ? Number(roundDoc.duration) : Infinity
  const capSec = Number.isFinite(durMs) ? Math.max(0, durMs / 1000) : Infinity
  const elapsedSec = Math.max(0, Math.min(elapsedMs / 1000, capSec))
  return elapsedSec * SSC_PER_SECOND_ROUND
}

class GameEngine {
  constructor() {
    this.activeRounds = new Map()
    this.memoryOnly = false // when true, no MongoDB (dev without DB)
  }

  setMemoryOnly(value) {
    this.memoryOnly = !!value
  }

  async startRound(socketId, userId, wager, clientGold, guestId = null) {
    const defaultGuestGold = 10
    if (wager <= 0 || !Number.isFinite(wager)) {
      throw new Error('Invalid wager: insufficient gold or zero')
    }

    // For logged-in users: always use DB gold — deduct wager and save (Hold)
    let goldAfterHold = null
    if (userId) {
      const User = (await import('../models/User.js')).default
      const user = await User.findById(userId)
      if (!user) throw new Error('User not found')
      const userGold = user.gold ?? 0
      if (wager > userGold) throw new Error('Invalid wager: insufficient gold or zero')
      user.gold = userGold - wager
      // GDD 2.8: 1 Gold wagered = 1 XP; update rank
      user.totalWagered = (user.totalWagered || 0) + wager
      user.xp = user.totalWagered
      user.rank = getRankFromXP(user.xp)
      await user.save()
      goldAfterHold = user.gold
    } else {
      const guestGold = Number.isFinite(clientGold) && clientGold >= 0 ? clientGold : defaultGuestGold
      if (wager > guestGold) throw new Error('Invalid wager: insufficient gold or zero')
    }

    // Memory-only: one global round so everyone sees the same chart
    if (this.memoryOnly) {
      const existing = this.activeRounds.get(GLOBAL_ROUND_ID)
    if (existing && existing.intervalId != null) {
      const userKey = userId ? String(userId) : (guestId ? 'guest:' + guestId : 'socket:' + socketId)
      existing.participants.set(socketId, { wager, userId, userKey })
      if (!existing.participantsByUserKey) existing.participantsByUserKey = new Map()
      existing.participantsByUserKey.set(userKey, { socketId, wager, userId, guestId })
      return { round: existing.round, isNewRound: false, gold: goldAfterHold }
    }
      const userLevel = 1
      const targetMultiplier = this.generateTargetMultiplier(userLevel)
      const duration = this.calculateDuration(targetMultiplier)
      const headlines = this.generateHeadlines(duration)
      const round = {
        _id: { toString: () => GLOBAL_ROUND_ID },
        userId: null,
        wager: 0,
        targetMultiplier,
        duration,
        status: 'running'
      }
      const userKey = userId ? String(userId) : (guestId ? 'guest:' + guestId : 'socket:' + socketId)
      const roundData = {
        round,
        targetMultiplier,
        duration,
        headlines,
        startTime: Date.now(),
        currentMultiplier: 1.0,
        lastBroadcastMultiplier: 1.0,
        headlineIndex: 0,
        participants: new Map([[socketId, { wager, userId, userKey }]]),
        participantsByUserKey: new Map([[userKey, { socketId, wager, userId, guestId }]]),
        multiplierPath: [],
        oracleLevel: userLevel
      }
      this.activeRounds.set(GLOBAL_ROUND_ID, roundData)
      return { round, isNewRound: true, gold: goldAfterHold }
    }

    // DB mode: shared chart — one global round for all, each user gets a Round doc and joins participants
    const Round = (await import('../models/Round.js')).default
    const User = (await import('../models/User.js')).default
    const user = userId ? await User.findById(userId) : null
    const userLevel = user?.oracleLevel ?? 1
    const existing = this.activeRounds.get(GLOBAL_ROUND_ID)
    if (existing && existing.intervalId != null) {
      const roundDoc = await Round.create({
        userId: user ? user._id : null,
        wager,
        targetMultiplier: existing.targetMultiplier,
        duration: existing.duration,
        status: 'running'
      })
      if (!existing.participants) existing.participants = new Map()
      const userKey = userId ? String(userId) : (guestId ? 'guest:' + guestId : 'socket:' + socketId)
      existing.participants.set(socketId, { wager, userId, roundId: roundDoc._id, userKey })
      if (!existing.participantsByUserKey) existing.participantsByUserKey = new Map()
      existing.participantsByUserKey.set(userKey, { socketId, wager, userId, guestId, roundId: roundDoc._id })
      const round = { _id: { toString: () => GLOBAL_ROUND_ID }, wager, status: 'running' }
      return { round, isNewRound: false, gold: goldAfterHold }
    }
    const targetMultiplier = this.generateTargetMultiplier(userLevel)
    const duration = this.calculateDuration(targetMultiplier)
    const headlines = this.generateHeadlines(duration)
    const roundDoc = await Round.create({
      userId: user ? user._id : null,
      wager,
      targetMultiplier,
      duration,
      status: 'running'
    })
    const round = {
      _id: { toString: () => GLOBAL_ROUND_ID },
      userId: user ? user._id : null,
      wager: 0,
      targetMultiplier,
      duration,
      status: 'running'
    }
    const userKey = userId ? String(userId) : (guestId ? 'guest:' + guestId : 'socket:' + socketId)
    const roundData = {
      round,
      targetMultiplier,
      duration,
      headlines,
      startTime: Date.now(),
      currentMultiplier: 1.0,
      lastBroadcastMultiplier: 1.0,
      headlineIndex: 0,
      participants: new Map([[socketId, { wager, userId, roundId: roundDoc._id, userKey }]]),
      participantsByUserKey: new Map([[userKey, { socketId, wager, userId, guestId, roundId: roundDoc._id }]]),
      multiplierPath: [],
      oracleLevel: userLevel
    }
    this.activeRounds.set(GLOBAL_ROUND_ID, roundData)
    return { round, isNewRound: true, gold: goldAfterHold }
  }

  /**
   * Re-attach a reconnected socket to their active round (e.g. after refresh). Returns round state if found.
   */
  async resumeRound(socketId, userId, guestId) {
    const userKey = userId ? String(userId) : (guestId ? 'guest:' + guestId : null)
    if (!userKey) return null
    const roundData = this.activeRounds.get(GLOBAL_ROUND_ID)
    if (!roundData || !roundData.intervalId) return null
    const byKey = roundData.participantsByUserKey
    if (!byKey) return null
    const participant = byKey.get(userKey)
    if (!participant) return null
    const oldSocketId = participant.socketId
    if (oldSocketId) roundData.participants.delete(oldSocketId)
    participant.socketId = socketId
    const { wager, roundId } = participant
    roundData.participants.set(socketId, {
      wager,
      userId: participant.userId,
      roundId,
      userKey
    })
    let gold = null
    if (participant.userId) {
      try {
        const User = (await import('../models/User.js')).default
        const user = await User.findById(participant.userId).select('gold').lean()
        if (user && typeof user.gold === 'number') gold = user.gold
      } catch (e) { /* ignore */ }
    }
    return {
      roundId: GLOBAL_ROUND_ID,
      wager,
      path: roundData.multiplierPath ?? [],
      currentMultiplier: roundData.currentMultiplier ?? 1.0,
      gold
    }
  }

  /**
   * On socket disconnect: remove from participants map but keep in participantsByUserKey so they can resume.
   */
  onSocketDisconnect(socketId) {
    const roundData = this.activeRounds.get(GLOBAL_ROUND_ID)
    if (!roundData || !roundData.participants) return
    const participant = roundData.participants.get(socketId)
    if (!participant) return
    const userKey = participant.userKey
    roundData.participants.delete(socketId)
    const byKey = roundData.participantsByUserKey
    if (byKey && userKey) {
      const entry = byKey.get(userKey)
      if (entry) entry.socketId = null
    }
  }

  // GDD 8.2: Pattern Overclock — ceiling caps target; floor used in debt trap
  generateTargetMultiplier(userLevel = 1) {
    const ceiling = getCeiling(userLevel)
    const rand = Math.random()
    let target
    if (rand < 0.45) {
      target = 1.0 + Math.random() * 0.5
    } else if (rand < 0.72) {
      target = -0.5 + Math.random() * 1.5
    } else if (rand < 0.92) {
      target = 1.2 + Math.random() * 2.3
    } else if (rand < 0.98) {
      target = 3.0 + Math.random() * 7.0
    } else {
      target = 10.0 + Math.random() * 15.0
    }
    return Math.min(target, ceiling)
  }

  calculateDuration(targetMultiplier) {
    if (targetMultiplier >= 5.0) {
      // Deep/God Runs: 60s - 180s
      return 60000 + Math.random() * 120000
    } else {
      // Standard Runs: 10s - 60s
      return 10000 + Math.random() * 50000
    }
  }

  // GDD 2.1: Pick-A-Slot — Runs < 15s: 1 Headline; 15s–40s: 2; > 40s: 3. Tier from progress.
  generateHeadlines(duration) {
    const headlines = []
    const numHeadlines = duration < 15000 ? 1 : duration < 40000 ? 2 : 3
    const TIER_4_CHANCE = 0.08 // GDD: Tier 4 Anomaly (pattern breaker) occasionally
    for (let i = 0; i < numHeadlines; i++) {
      const progress = (i + 1) / (numHeadlines + 1)
      const triggerTime = duration * progress
      let tier
      if (Math.random() < TIER_4_CHANCE) {
        tier = 4
      } else if (progress < 0.5) {
        tier = 1
      } else if (progress < 0.85) {
        tier = 2
      } else {
        tier = 3
      }
      const isBluff = tier === 3 && Math.random() < 0.15 // GDD: 15% Tier 3 Double Bluff (Tier 1 text)
      headlines.push({
        tier,
        triggerTime,
        text: getHeadlineForTier(tier, isBluff),
        isBluff
      })
    }
    return headlines.sort((a, b) => a.triggerTime - b.triggerTime)
  }

  async runRound(roundId, onUpdate) {
    const roundData = this.activeRounds.get(roundId.toString())
    if (!roundData) return

    const { targetMultiplier, duration, headlines, startTime } = roundData
    const safetyZone = 7000 // 7 seconds

    // Random walk state: velocity shifting (step size varies every 2–4s), pattern break (wobble after 3s up)
    roundData.randomWalkTicksUp = roundData.randomWalkTicksUp ?? 0
    roundData.stepSpeedMultiplier = roundData.stepSpeedMultiplier ?? (0.85 + Math.random() * 0.3)
    roundData.nextSpeedChangeAt = roundData.nextSpeedChangeAt ?? (Date.now() + 2000 + Math.random() * 2000)

    const interval = setInterval(async () => {
      // GDD 2.7.2: During headline freeze (7s), do not advance multiplier — Blind Fold: fold at frozen value
      if (roundData.headlineFreezeUntil) {
        if (Date.now() < roundData.headlineFreezeUntil) return
        roundData.headlineFreezeUntil = null
      }

      const elapsed = Date.now() - startTime
      const progress = elapsed / duration

      if (!roundData.multiplierPath) roundData.multiplierPath = []

      if (elapsed < safetyZone) {
        const prev = roundData.currentMultiplier
        const floor = getFloor(roundData.oracleLevel ?? 1)
        const ceiling = getCeiling(roundData.oracleLevel ?? 1)
        // Green bias in safety: 60/40 toward above 1.0; if < 1.0 add +10% push toward 1.0
        let delta = (Math.random() - 0.4) * 0.04
        if (prev < 1.0) delta += 0.10 * (1.0 - prev)
        const multiplier = Math.max(floor, Math.min(ceiling, Math.max(0.95, Math.min(1.05, prev + delta))))
        roundData.currentMultiplier = multiplier
        roundData.lastBroadcastMultiplier = multiplier
        roundData.multiplierPath.push(multiplier)
        if (roundData.multiplierPath.length > 300) roundData.multiplierPath = roundData.multiplierPath.slice(-300)
        onUpdate(multiplier, 'safe', null, roundData.multiplierPath.length)
        return
      }

      if (progress >= 1.0) {
        clearInterval(interval)
        roundData.intervalId = null
        const rawMult = roundData.currentMultiplier
        const oracleLevel = roundData.oracleLevel ?? 1
        const floor = getFloor(oracleLevel)
        // GDD 2.4 + 8.2: 85% Hard Bust (0x), 15% Debt Trap use Volatility Floor as minimum
        const exitRoll = Math.random()
        let finalMult = rawMult
        if (exitRoll < 0.85) {
          finalMult = 0
        } else if (exitRoll < 0.95) {
          finalMult = Math.max(floor, rawMult)
        } else {
          finalMult = Math.max(floor, rawMult * 0.8)
        }
        roundData.multiplierPath.push(finalMult)
        const participants = roundData.participants
        if (participants && participants.size > 0) {
          let totalWagered = 0
          for (const [, p] of participants) totalWagered += p.wager || 0
          if (totalWagered > 0) mercyPotAdd(totalWagered * 0.1)
        }
        const roundIdStr = roundId.toString()
        const pathLen = roundData.multiplierPath.length
        if (roundIdStr === GLOBAL_ROUND_ID && participants && participants.size > 0 && !this.memoryOnly) {
          const Round = (await import('../models/Round.js')).default
          const User = (await import('../models/User.js')).default
          const achievementsBySocketId = {}
          for (const [socketId, p] of participants) {
            const rid = p.roundId != null ? (typeof p.roundId === 'string' ? p.roundId : String(p.roundId)) : null
            if (!rid) continue
            const roundDoc = await Round.findById(rid)
            if (roundDoc && roundDoc.status === 'running') {
              roundDoc.finalMultiplier = finalMult
              roundDoc.status = 'crashed'
              roundDoc.endedAt = new Date()
              await roundDoc.save()
            }
            if (p.userId) {
              const user = await User.findById(p.userId)
              if (user) {
                user.totalRounds = (user.totalRounds || 0) + 1
                user.currentStreak = 0
                user.timesCrashed = (user.timesCrashed || 0) + 1
                user.maxMultiplierReached = Math.max(user.maxMultiplierReached || 1, finalMult)
                user.currentConsecutiveMaxWager = 0
                const wallet = (user.gold || 0) + p.wager
                const marginCall = (user.oracleLevel || 1) === 10 && finalMult <= getFloor(10) && p.wager > 0.45 * wallet
                const payout = marginCall ? 0 : p.wager * Math.max(0, finalMult)
                user.gold = (user.gold || 0) + payout
                if (user.gold <= 0) user.timesBankrupt = (user.timesBankrupt || 0) + 1
                await user.save()
                const loss = p.wager - payout
                if (loss > 0) {
                  try {
                    const leaderboard = await import('./leaderboardService.js')
                    await leaderboard.recordUserLoss(p.userId, user.username, loss)
                  } catch (e) {
                    console.warn('[gameEngine] leaderboard recordUserLoss failed:', e?.message)
                  }
                }
                try {
                  const newAch = await checkAndUnlock(p.userId.toString())
                  if (newAch.length) achievementsBySocketId[socketId] = newAch
                } catch (e) {
                  console.warn('[gameEngine] achievement check failed:', e?.message)
                }
              }
            }
          }
          onUpdate(finalMult, 'crashed', null, pathLen, { achievementsBySocketId })
          this.activeRounds.delete(GLOBAL_ROUND_ID)
          return
        }
        if (participants && participants.size > 0 && this.memoryOnly) {
          const User = (await import('../models/User.js')).default
          const achievementsBySocketId = {}
          for (const [socketId, p] of participants) {
            if (p.userId) {
              const user = await User.findById(p.userId)
              if (user) {
                user.totalRounds = (user.totalRounds || 0) + 1
                user.timesCrashed = (user.timesCrashed || 0) + 1
                user.maxMultiplierReached = Math.max(user.maxMultiplierReached || 1, finalMult)
                user.currentConsecutiveMaxWager = 0
                if (finalMult < 1) user.currentStreak = 0
                const wallet = (user.gold || 0) + p.wager
                const marginCall = (user.oracleLevel || 1) === 10 && finalMult <= getFloor(10) && p.wager > 0.45 * wallet
                const payout = marginCall ? 0 : p.wager * Math.max(0, finalMult)
                user.gold = (user.gold || 0) + payout
                if (user.gold <= 0) user.timesBankrupt = (user.timesBankrupt || 0) + 1
                if (finalMult >= 1) {
                  const profit = p.wager * (finalMult - 1)
                  user.totalSiphoned = (user.totalSiphoned || 0) + profit
                  user.roundsWon = (user.roundsWon || 0) + 1
                  user.currentStreak = (user.currentStreak || 0) + 1
                  user.bestStreak = Math.max(user.bestStreak || 0, user.currentStreak)
                  user.totalMultiplierSum = (user.totalMultiplierSum || 0) + finalMult
                }
                await user.save()
                const loss = p.wager - payout
                if (loss > 0) {
                  try {
                    const leaderboard = await import('./leaderboardService.js')
                    await leaderboard.recordUserLoss(p.userId, user.username, loss)
                  } catch (e) {
                    console.warn('[gameEngine] leaderboard recordUserLoss failed:', e?.message)
                  }
                }
                try {
                  const newAch = await checkAndUnlock(p.userId.toString())
                  if (newAch.length) achievementsBySocketId[socketId] = newAch
                } catch (e) {
                  console.warn('[gameEngine] achievement check failed:', e?.message)
                }
              }
            }
          }
          onUpdate(finalMult, 'crashed', null, pathLen, { achievementsBySocketId })
        }
        if (!(participants && participants.size > 0 && this.memoryOnly)) {
          onUpdate(finalMult, 'crashed', null, pathLen)
        }
        await this.endRound(roundId, finalMult, 'crashed')
        return
      }

      const oracleLevel = roundData.oracleLevel ?? 1
      const floor = getFloor(oracleLevel)
      const ceiling = getCeiling(oracleLevel)
      const current = roundData.currentMultiplier

      // Velocity shifting: change step speed every 2–4s so run length varies
      if (Date.now() >= roundData.nextSpeedChangeAt) {
        roundData.stepSpeedMultiplier = 0.7 + Math.random() * 0.6
        roundData.nextSpeedChangeAt = Date.now() + 2000 + Math.random() * 2000
      }
      const baseStep = 0.025 * roundData.stepSpeedMultiplier
      // Green bias: 60/40 weight toward staying above 1.0
      let step = (Math.random() - 0.4) * 2 * baseStep
      if (current < 1.0) step += 0.10 * (1.0 - current)
      // Pattern breaking: if moving up > 3s, increase probability of small down tick (wobble)
      if (roundData.randomWalkTicksUp > 30) {
        step -= 0.02
        roundData.randomWalkTicksUp = 0
      }
      let multiplier = Math.max(floor, Math.min(ceiling, current + step))
      if (multiplier > current) roundData.randomWalkTicksUp = (roundData.randomWalkTicksUp || 0) + 1
      else roundData.randomWalkTicksUp = 0

      roundData.currentMultiplier = multiplier
      roundData.lastBroadcastMultiplier = multiplier
      roundData.multiplierPath.push(multiplier)
      if (roundData.multiplierPath.length > 300) roundData.multiplierPath = roundData.multiplierPath.slice(-300)

      const nextHeadline = headlines[roundData.headlineIndex]
      if (nextHeadline && elapsed >= nextHeadline.triggerTime) {
        roundData.headlineIndex++
        // GDD 2.7.2: Freeze multiplier for 7s so fold during headline settles at frozen value
        roundData.headlineFreezeUntil = Date.now() + 7000
        // GDD 2.3: 15% Tier 3 Bluff = path continues 10s+
        if (nextHeadline.isBluff) roundData.duration += 10000
        onUpdate(multiplier, 'headline', nextHeadline, roundData.multiplierPath.length)
      } else {
        onUpdate(multiplier, 'running', null, roundData.multiplierPath.length)
      }
    }, 100)
    roundData.intervalId = interval
  }

  // GDD 8.2: Clamp to floor/ceiling; descent velocity +10% per Oracle Level when in red/orange
  calculateWobbleMultiplier(progress, targetMultiplier, duration, oracleLevel = 1, floor = -0.1, ceiling = 1.5) {
    const time = progress * duration / 1000
    const rampEnd = 15
    const intensity = Math.min(1, time / rampEnd)
    const sine = Math.sin(time * 0.8) * 0.45 * intensity
    let noise = (Math.random() - 0.55) * 0.35 * intensity
    const descentBoost = 1 + 0.1 * (oracleLevel - 1)
    const baseMultiplier = 1.0 + (targetMultiplier - 1.0) * progress
    let multiplier = baseMultiplier + sine + noise
    if (multiplier < 0.5) {
      noise = (Math.random() - 0.6) * 0.35 * intensity * descentBoost
      multiplier = baseMultiplier + sine + noise
    }
    multiplier = Math.max(floor, Math.min(ceiling, multiplier))
    return multiplier
  }

  async foldRound(socketId, roundId, clientMultiplier) {
    const roundIdStr = roundId.toString()
    const roundData = this.activeRounds.get(roundIdStr)
    if (!roundData) return null

    // Global round (shared chart): fold this participant only; do not stop the round
    if (roundIdStr === GLOBAL_ROUND_ID && roundData.participants) {
      const participant = roundData.participants.get(socketId)
      if (!participant) return null
      const userKey = participant.userKey
      // Use last value we broadcast to clients (what they saw), not currentMultiplier which may have ticked again
      const serverMult = roundData.lastBroadcastMultiplier ?? roundData.currentMultiplier
      // Allow client multiplier within 5% above server (latency tolerance)
      let finalMultiplier = serverMult
      if (
        typeof clientMultiplier === 'number' &&
        serverMult > 0 &&
        clientMultiplier <= serverMult * 1.05 &&
        clientMultiplier > serverMult
      ) {
        finalMultiplier = clientMultiplier
      }
      const profit = participant.wager * (Math.max(0, finalMultiplier) - 1.0)
      const payout = participant.wager + profit
      if (participant.wager > 0) mercyPotAdd(participant.wager * 0.05)
      roundData.participants.delete(socketId)
      if (userKey && roundData.participantsByUserKey) roundData.participantsByUserKey.delete(userKey)
      let goldAfterFold = null
      let stats = null
      let leaderboardRank = null
      let leaderboardTotalPlayers = null
      const Round = (await import('../models/Round.js')).default
      const rid = participant.roundId != null ? (typeof participant.roundId === 'string' ? participant.roundId : String(participant.roundId)) : null
      const roundDoc = rid ? await Round.findById(rid) : null
      if (roundDoc && roundDoc.status === 'running') {
        roundDoc.folded = true
        roundDoc.foldMultiplier = finalMultiplier
        roundDoc.profit = profit
        roundDoc.status = 'folded'
        roundDoc.endedAt = new Date()
        await roundDoc.save()
      }
      let newAchievements = []
      let sscEarnedThisRound = 0
      let metalAfterFold = null
      let sscEarnedTotal = null
      if (participant.userId) {
        const User = (await import('../models/User.js')).default
        const user = await User.findById(participant.userId)
        if (user) {
          user.gold = (user.gold || 0) + payout
          user.totalRounds = (user.totalRounds || 0) + 1
          user.totalSiphoned = (user.totalSiphoned || 0) + profit
          if (profit > (user.biggestExtract || 0)) user.biggestExtract = profit
          user.maxMultiplierReached = Math.max(user.maxMultiplierReached || 1, finalMultiplier)
          const cap = user.wagerCap || 2
          if (participant.wager >= cap) {
            user.currentConsecutiveMaxWager = (user.currentConsecutiveMaxWager || 0) + 1
          } else {
            user.currentConsecutiveMaxWager = 0
          }
          user.bestConsecutiveMaxWager = Math.max(user.bestConsecutiveMaxWager || 0, user.currentConsecutiveMaxWager || 0)
          const won = finalMultiplier >= 1
          if (won) {
            user.roundsWon = (user.roundsWon || 0) + 1
            user.currentStreak = (user.currentStreak || 0) + 1
            user.bestStreak = Math.max(user.bestStreak || 0, user.currentStreak)
            user.totalMultiplierSum = (user.totalMultiplierSum || 0) + finalMultiplier
          } else {
            user.currentStreak = 0
          }
          if (roundDoc) {
            sscEarnedThisRound = computeSscReportForRound(roundDoc)
          }
          await user.save()
          goldAfterFold = user.gold
          metalAfterFold = getSscBalance(user)
          sscEarnedTotal = getSscBalance(user)
          const tr = user.totalRounds || 0
          const rw = user.roundsWon || 0
          stats = {
            totalRounds: tr,
            bestStreak: user.bestStreak || 0,
            winRate: tr > 0 ? (rw / tr) * 100 : 0,
            avgMultiplier: rw > 0 ? (user.totalMultiplierSum || 0) / rw : 0
          }
          try {
            newAchievements = await checkAndUnlock(participant.userId.toString())
          } catch (e) {
            console.warn('[gameEngine] achievement check failed:', e?.message)
          }
          try {
            const leaderboard = await import('./leaderboardService.js')
            await leaderboard.upsertUserEntry(user._id, user.username, profit, user.biggestExtract)
            // Success banner shows rank by best single run (biggestExtract), not total siphoned
            const rankResult = await leaderboard.getRankByUserId(user._id, 'biggestExtract')
            if (rankResult) {
              leaderboardRank = rankResult.rank
              leaderboardTotalPlayers = await leaderboard.getTotalPlayers()
            }
          } catch (e) {
            console.warn('[gameEngine] leaderboard sync failed:', e?.message)
          }
        }
      }
      return {
        multiplier: finalMultiplier,
        profit,
        wager: participant.wager,
        gold: goldAfterFold,
        metal: metalAfterFold ?? undefined,
        sscBalance: metalAfterFold ?? undefined,
        user_ssc_balance: metalAfterFold ?? undefined,
        sscEarnedThisRound: sscEarnedThisRound > 0 ? sscEarnedThisRound : undefined,
        sscEarnedTotal: sscEarnedTotal != null ? sscEarnedTotal : undefined,
        stats,
        leaderboardRank: leaderboardRank ?? undefined,
        leaderboardTotalPlayers: leaderboardTotalPlayers ?? undefined,
        newAchievements: newAchievements.length ? newAchievements : undefined
      }
    }

    if (this.memoryOnly && roundIdStr === GLOBAL_ROUND_ID) {
      const participant = roundData.participants?.get(socketId)
      if (!participant) return null
      const userKey = participant.userKey
      const finalMultiplier = roundData.currentMultiplier
      const profit = participant.wager * (Math.max(0, finalMultiplier) - 1.0)
      const payout = participant.wager + profit
      if (participant.wager > 0) mercyPotAdd(participant.wager * 0.05)
      roundData.participants.delete(socketId)
      if (userKey && roundData.participantsByUserKey) roundData.participantsByUserKey.delete(userKey)
      let goldAfterFold = null
      let stats = null
      let leaderboardRank = null
      let leaderboardTotalPlayers = null
      let newAchievements = []
      let sscEarnedThisRound = 0
      let metalAfterFold = null
      let sscEarnedTotal = null
      const RoundModel = (await import('../models/Round.js')).default
      const ridMem = participant.roundId != null ? (typeof participant.roundId === 'string' ? participant.roundId : String(participant.roundId)) : null
      const roundDocMem = ridMem ? await RoundModel.findById(ridMem).select('duration createdAt').lean() : null
      if (participant.userId) {
        const User = (await import('../models/User.js')).default
        const user = await User.findById(participant.userId)
        if (user) {
          user.gold = (user.gold || 0) + payout
          user.totalRounds = (user.totalRounds || 0) + 1
          user.totalSiphoned = (user.totalSiphoned || 0) + profit
          if (profit > (user.biggestExtract || 0)) user.biggestExtract = profit
          user.maxMultiplierReached = Math.max(user.maxMultiplierReached || 1, finalMultiplier)
          const cap = user.wagerCap || 2
          if (participant.wager >= cap) {
            user.currentConsecutiveMaxWager = (user.currentConsecutiveMaxWager || 0) + 1
          } else {
            user.currentConsecutiveMaxWager = 0
          }
          user.bestConsecutiveMaxWager = Math.max(user.bestConsecutiveMaxWager || 0, user.currentConsecutiveMaxWager || 0)
          const won = finalMultiplier >= 1
          if (won) {
            user.roundsWon = (user.roundsWon || 0) + 1
            user.currentStreak = (user.currentStreak || 0) + 1
            user.bestStreak = Math.max(user.bestStreak || 0, user.currentStreak)
            user.totalMultiplierSum = (user.totalMultiplierSum || 0) + finalMultiplier
          } else {
            user.currentStreak = 0
          }
          if (roundDocMem) {
            sscEarnedThisRound = computeSscReportForRound(roundDocMem)
          }
          await user.save()
          goldAfterFold = user.gold
          metalAfterFold = getSscBalance(user)
          sscEarnedTotal = getSscBalance(user)
          const tr = user.totalRounds || 0
          const rw = user.roundsWon || 0
          stats = {
            totalRounds: tr,
            bestStreak: user.bestStreak || 0,
            winRate: tr > 0 ? (rw / tr) * 100 : 0,
            avgMultiplier: rw > 0 ? (user.totalMultiplierSum || 0) / rw : 0
          }
          try {
            newAchievements = await checkAndUnlock(participant.userId.toString())
          } catch (e) {
            console.warn('[gameEngine] achievement check failed:', e?.message)
          }
          try {
            const leaderboard = await import('./leaderboardService.js')
            await leaderboard.upsertUserEntry(user._id, user.username, profit, user.biggestExtract)
            // Success banner shows rank by best single run (biggestExtract), not total siphoned
            const rankResult = await leaderboard.getRankByUserId(user._id, 'biggestExtract')
            if (rankResult) {
              leaderboardRank = rankResult.rank
              leaderboardTotalPlayers = await leaderboard.getTotalPlayers()
            }
          } catch (e) {
            console.warn('[gameEngine] leaderboard sync failed:', e?.message)
          }
        }
      }
      return {
        multiplier: finalMultiplier,
        profit,
        wager: participant.wager,
        gold: goldAfterFold,
        metal: metalAfterFold ?? undefined,
        sscBalance: metalAfterFold ?? undefined,
        user_ssc_balance: metalAfterFold ?? undefined,
        sscEarnedThisRound: sscEarnedThisRound > 0 ? sscEarnedThisRound : undefined,
        sscEarnedTotal: sscEarnedTotal != null ? sscEarnedTotal : undefined,
        stats,
        leaderboardRank: leaderboardRank ?? undefined,
        leaderboardTotalPlayers: leaderboardTotalPlayers ?? undefined,
        newAchievements: newAchievements.length ? newAchievements : undefined
      }
    }

    // DB mode: one round per player, stop interval and settle
    if (roundData.intervalId) {
      clearInterval(roundData.intervalId)
      roundData.intervalId = null
    }

    const round = this.memoryOnly ? roundData.round : await (await import('../models/Round.js')).default.findById(roundId)
    if (!round || round.status !== 'running') return null

    const finalMultiplier = roundData.currentMultiplier
    const profit = round.wager * (Math.max(0, finalMultiplier) - 1.0)
    const payout = round.wager + profit
    let stats = null
    let sscEarnedThisRound = 0
    let sscEarnedTotal = null
    let metalAfterFold = null

    if (!this.memoryOnly) {
      const User = (await import('../models/User.js')).default
      round.folded = true
      round.foldMultiplier = finalMultiplier
      round.profit = profit
      round.status = 'folded'
      round.endedAt = new Date()
      await round.save()
      if (round.wager > 0) mercyPotAdd(round.wager * 0.05)
      if (round.userId) {
        const user = await User.findById(round.userId)
        if (user) {
          user.gold = (user.gold || 0) + payout
          user.totalSiphoned = (user.totalSiphoned || 0) + round.wager
          if (profit > (user.biggestExtract || 0)) user.biggestExtract = profit
          user.totalRounds = (user.totalRounds || 0) + 1
          const won = finalMultiplier >= 1
          if (won) {
            user.roundsWon = (user.roundsWon || 0) + 1
            user.currentStreak = (user.currentStreak || 0) + 1
            user.bestStreak = Math.max(user.bestStreak || 0, user.currentStreak)
            user.totalMultiplierSum = (user.totalMultiplierSum || 0) + finalMultiplier
          } else {
            user.currentStreak = 0
          }
          sscEarnedThisRound = computeSscReportForRound(round)
          await user.save()
          metalAfterFold = getSscBalance(user)
          sscEarnedTotal = getSscBalance(user)
          const tr = user.totalRounds || 0
          const rw = user.roundsWon || 0
          stats = {
            totalRounds: tr,
            bestStreak: user.bestStreak || 0,
            winRate: tr > 0 ? (rw / tr) * 100 : 0,
            avgMultiplier: rw > 0 ? (user.totalMultiplierSum || 0) / rw : 0
          }
        }
      }
    }

    this.activeRounds.delete(roundId.toString())

    const gold = round.userId && !this.memoryOnly
      ? (await (await import('../models/User.js')).default.findById(round.userId))?.gold
      : null
    return {
      multiplier: finalMultiplier,
      profit,
      wager: round.wager,
      gold,
      metal: metalAfterFold ?? undefined,
      sscBalance: metalAfterFold ?? undefined,
      user_ssc_balance: metalAfterFold ?? undefined,
      sscEarnedThisRound: sscEarnedThisRound > 0 ? sscEarnedThisRound : undefined,
      sscEarnedTotal: sscEarnedTotal != null ? sscEarnedTotal : undefined,
      stats
    }
  }

  async endRound(roundId, finalMultiplier, status) {
    const roundIdStr = typeof roundId === 'string' ? roundId : (roundId && typeof roundId.toString === 'function' ? roundId.toString() : String(roundId))
    if (this.memoryOnly && roundIdStr === GLOBAL_ROUND_ID) {
      this.activeRounds.delete(GLOBAL_ROUND_ID)
      return
    }
    if (roundIdStr === GLOBAL_ROUND_ID) {
      this.activeRounds.delete(GLOBAL_ROUND_ID)
      return
    }
    if (!this.memoryOnly) {
      const Round = (await import('../models/Round.js')).default
      const User = (await import('../models/User.js')).default
      const round = await Round.findById(roundIdStr)
      if (round) {
        round.finalMultiplier = finalMultiplier
        round.status = status
        round.endedAt = new Date()
        await round.save()
        if (status === 'crashed' && round.userId) {
          const user = await User.findById(round.userId)
          if (user) {
            user.totalSiphoned = (user.totalSiphoned || 0) + round.wager
            user.totalRounds = (user.totalRounds || 0) + 1
            user.currentStreak = 0
            await user.save()
          }
        }
      }
    }
    this.activeRounds.delete(roundIdStr)
  }
}

export const gameEngine = new GameEngine()
