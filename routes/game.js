import express from 'express'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { addAdContribution } from '../services/mercyPotService.js'
import { checkAndUnlock } from '../services/achievementService.js'
import { standardAdRewardByRank, emergencySiphonRewardByRank } from '../config/economy.js'
import { SSC_VIDEO_AD_REWARD } from '../config/sscConstants.js'
import { getSscBalance } from '../utils/sscBalance.js'

const router = express.Router()

// POST /api/game/siphon — grant scrap gold (after rewarded ad). Body: { emergency: true } for bailout when wallet < 1.
router.post('/siphon', requireAuth, async (req, res) => {
  try {
    const user = req.user
    const rank = user.rank ?? 0
    const emergency = req.body && req.body.emergency === true
    const amount = emergency ? emergencySiphonRewardByRank(rank) : standardAdRewardByRank(rank)
    const full = await User.findById(user._id)
    if (!full) return res.status(404).json({ error: 'User not found' })
    const currentGold = Number(full.gold) || 0
    const newGold = currentGold + amount
    const mult = full.propagandaFilter ? 2 : 1
    const sscFromAd = SSC_VIDEO_AD_REWARD * mult
    if (full.sscBalance == null && full.metal != null) full.sscBalance = full.metal
    full.sscBalance = (full.sscBalance ?? 0) + sscFromAd
    full.gold = newGold
    full.adsWatched = (full.adsWatched ?? 0) + 1
    await full.save()
    const updated = full
    addAdContribution() // GDD 6: Rewarded Ad Watch +$0.0040 SSC to Holding Bucket
    const newAchievements = await checkAndUnlock(user._id.toString())
    const bal = getSscBalance(updated)
    res.json({
      gold: newGold,
      added: amount,
      metal: bal,
      sscBalance: bal,
      user_ssc_balance: bal,
      sscEarned: bal,
      sscFromAd,
      video_ad_complete: true,
      newAchievements,
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Get user game state
router.get('/state/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    const bal = getSscBalance(user)
    res.json({
      gold: user.gold,
      metal: bal,
      sscBalance: bal,
      user_ssc_balance: bal,
      sscEarned: bal,
      rank: user.rank,
      xp: user.xp,
      wagerCap: user.wagerCap
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
