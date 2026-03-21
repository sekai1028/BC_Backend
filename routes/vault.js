import express from 'express'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { getSscBalance } from '../utils/sscBalance.js'
import { toClientUser } from './auth.js'
import {
  VAULT_LEGEND_MIN_SSC,
  VAULT_LEGEND_WAGER_MILESTONE,
  VAULT_LEGEND_ORACLE_LEVEL
} from '../config/vaultLegendConstants.js'

const router = express.Router()

function eligibilityPayload(userDoc) {
  const ssc = getSscBalance(userDoc)
  const wager = userDoc.totalWagered ?? userDoc.xp ?? 0
  const oracle = userDoc.oracleLevel ?? 1
  return {
    vaultLegendUnlocked: !!userDoc.vaultLegendUnlocked,
    checks: {
      sscOk: ssc >= VAULT_LEGEND_MIN_SSC,
      sscBalance: ssc,
      minSsc: VAULT_LEGEND_MIN_SSC,
      wagerOk: wager >= VAULT_LEGEND_WAGER_MILESTONE,
      totalWagered: wager,
      wagerMilestone: VAULT_LEGEND_WAGER_MILESTONE,
      oracleOk: oracle >= VAULT_LEGEND_ORACLE_LEVEL,
      oracleLevel: oracle,
      oracleRequired: VAULT_LEGEND_ORACLE_LEVEL
    },
    eligibleForProtocol:
      !userDoc.vaultLegendUnlocked &&
      ssc >= VAULT_LEGEND_MIN_SSC &&
      wager >= VAULT_LEGEND_WAGER_MILESTONE &&
      oracle >= VAULT_LEGEND_ORACLE_LEVEL
  }
}

/**
 * GET /api/vault/status — eligibility for Vault Access Protocol (auth)
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json(eligibilityPayload(user))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

/**
 * POST /api/vault/authenticate
 * Body: { depositSsc?: number } — minimum VAULT_LEGEND_MIN_SSC; debits from SSC wallet.
 */
router.post('/authenticate', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (user.vaultLegendUnlocked) {
      return res.status(400).json({ message: 'Credential already verified.' })
    }

    const wager = user.totalWagered ?? user.xp ?? 0
    const oracle = user.oracleLevel ?? 1
    const bal = getSscBalance(user)

    if (bal < VAULT_LEGEND_MIN_SSC) {
      return res.status(400).json({ message: `Need at least ${VAULT_LEGEND_MIN_SSC} SSC.` })
    }
    if (wager < VAULT_LEGEND_WAGER_MILESTONE) {
      return res.status(400).json({ message: `Wager milestone not met (${VAULT_LEGEND_WAGER_MILESTONE} Gold).` })
    }
    if (oracle < VAULT_LEGEND_ORACLE_LEVEL) {
      return res.status(400).json({ message: `AI Oracle must be Level ${VAULT_LEGEND_ORACLE_LEVEL}.` })
    }

    let deposit = Number(req.body?.depositSsc)
    if (!Number.isFinite(deposit) || deposit <= 0) deposit = VAULT_LEGEND_MIN_SSC
    deposit = Math.round(deposit * 1e9) / 1e9

    if (deposit < VAULT_LEGEND_MIN_SSC) {
      return res.status(400).json({ message: `Minimum deposit is ${VAULT_LEGEND_MIN_SSC} SSC.` })
    }
    if (deposit > bal) {
      return res.status(400).json({ message: 'Insufficient SSC balance.' })
    }

    const next = Math.max(0, bal - deposit)
    user.sscBalance = next
    user.metal = next
    user.vaultLegendUnlocked = true
    const ach = Array.isArray(user.achievements) ? user.achievements : []
    if (!ach.includes('legendary-syndicate-slayer')) {
      user.achievements = [...ach, 'legendary-syndicate-slayer']
    }
    await user.save({ validateBeforeSave: false })

    res.json({
      ok: true,
      depositSsc: deposit,
      user: toClientUser(user)
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
