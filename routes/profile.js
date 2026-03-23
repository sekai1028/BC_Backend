import express from 'express'
import User from '../models/User.js'
import LeaderboardEntry from '../models/LeaderboardEntry.js'
import { requireAuth } from '../middleware/auth.js'
import { getVaultConfig, getVaultUpgradeInfo } from '../utils/vaultLevels.js'
import { ORACLE_LEVELS } from '../utils/oracleLevels.js'
import { getSscBalance } from '../utils/sscBalance.js'

const router = express.Router()
const USERNAME_COST_GOLD = 500

function toClientUser(doc) {
  if (!doc) return null
  const bal = getSscBalance(doc)
  return {
    id: doc._id.toString(),
    username: doc.username || doc.email?.split('@')[0] || 'Exile',
    email: doc.email,
    rank: doc.rank ?? 0,
    xp: doc.xp ?? 0,
    verified: !!doc.verified,
    gold: doc.gold ?? 0,
    metal: bal,
    sscBalance: bal,
    user_ssc_balance: bal,
    sscEarned: bal,
    propagandaFilter: !!doc.propagandaFilter,
    leaderboardBunkerTag: !!doc.leaderboardBunkerTag,
    leaderboardGlowColor: doc.leaderboardGlowColor || '#00FF41',
    twoFactorEnabled: !!doc.twoFactorEnabled,
    metalMod: doc.metalMod ?? 0,
    oracleMod: doc.oracleMod ?? 0,
    wagerCap: doc.wagerCap ?? getVaultConfig(doc.vaultLevel ?? 1).wagerCap,
    vaultLevel: doc.vaultLevel ?? 1,
    oracleLevel: doc.oracleLevel ?? 0,
    vaultLegendUnlocked: !!doc.vaultLegendUnlocked
  }
}

// GDD 8: Vault (Trading License) upgrade — pay Gold, requires Rank; increases wager cap
router.post('/vault-upgrade', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    const currentLevel = Math.max(1, Math.min(10, user.vaultLevel ?? 1))
    const next = getVaultUpgradeInfo(currentLevel)
    if (!next || next.costGold == null) {
      return res.status(400).json({ message: 'Vault already at max level' })
    }
    const rank = user.rank ?? 0
    if (rank < (next.requiredRank ?? 0)) {
      return res.status(400).json({ message: `Requires Rank ${next.requiredRank}` })
    }
    const gold = user.gold ?? 0
    if (gold < next.costGold) {
      return res.status(400).json({ message: `Need ${next.costGold} Gold. You have ${gold.toFixed(0)}.` })
    }
    user.gold = gold - next.costGold
    user.vaultLevel = next.nextLevel
    user.wagerCap = next.wagerCap
    await user.save({ validateBeforeSave: false })
    res.json({ message: 'Vault upgraded', user: toClientUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GDD 8: Oracle (AI Siphon) upgrade — pay Gold; increases idle rate and pattern ceiling/floor
router.post('/oracle-upgrade', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    const currentLevel = Math.max(0, Math.min(10, Math.floor(user.oracleLevel ?? 0)))
    if (currentLevel >= 10) {
      return res.status(400).json({ message: 'Oracle already at max level' })
    }
    const row = ORACLE_LEVELS[currentLevel]
    if (!row || row.upgradeGold == null) {
      return res.status(400).json({ message: 'Oracle upgrade not available' })
    }
    const costGold = row.upgradeGold
    const gold = user.gold ?? 0
    if (gold < costGold) {
      return res.status(400).json({ message: `Need ${costGold} Gold. You have ${gold.toFixed(0)}.` })
    }
    user.gold = gold - costGold
    user.oracleLevel = currentLevel + 1
    await user.save({ validateBeforeSave: false })
    res.json({ message: 'Oracle upgraded', user: toClientUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Change username (codename). First change free, then 500 gold. 3–15 chars, alphanumeric.
router.patch('/username', requireAuth, async (req, res) => {
  try {
    const raw = (req.body?.username ?? '').toString().trim()
    if (!/^[a-zA-Z0-9]{3,15}$/.test(raw)) {
      return res.status(400).json({ message: 'Username must be 3–15 characters, letters and numbers only' })
    }
    const newUsername = raw
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.username === newUsername) {
      return res.json({ message: 'No change', user: toClientUser(user) })
    }
    const existing = await User.findOne({ username: newUsername, _id: { $ne: user._id } })
    if (existing) {
      return res.status(400).json({ message: 'Username already taken' })
    }
    const changeCount = user.usernameChangeCount ?? 0
    if (changeCount >= 1) {
      const gold = user.gold ?? 0
      if (gold < USERNAME_COST_GOLD) {
        return res.status(400).json({ message: `Changing username costs ${USERNAME_COST_GOLD} gold. You have ${gold.toFixed(0)}.` })
      }
      user.gold = gold - USERNAME_COST_GOLD
    }
    user.username = newUsername
    user.usernameChangeCount = changeCount + 1
    await user.save({ validateBeforeSave: false })
    await LeaderboardEntry.findOneAndUpdate(
      { source: 'user', userId: user._id },
      { displayName: newUsername, updatedAt: new Date() }
    )
    res.json({ message: 'Username updated', user: toClientUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
