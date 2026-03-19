import express from 'express'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { addAdContribution } from '../services/mercyPotService.js'
import { checkAndUnlock } from '../services/achievementService.js'
import { standardAdRewardByRank, emergencySiphonRewardByRank } from '../config/economy.js'

const router = express.Router()

// POST /api/game/siphon — grant scrap gold (after rewarded ad). Body: { emergency: true } for bailout when wallet < 1.
router.post('/siphon', requireAuth, async (req, res) => {
  try {
    const user = req.user
    const rank = user.rank ?? 0
    const emergency = req.body && req.body.emergency === true
    const amount = emergency ? emergencySiphonRewardByRank(rank) : standardAdRewardByRank(rank)
    const currentGold = Number(user.gold) || 0
    const newGold = currentGold + amount
    await User.findByIdAndUpdate(user._id, { $set: { gold: newGold }, $inc: { adsWatched: 1 } })
    addAdContribution() // GDD 6: Rewarded Ad Watch +$0.0040 SSC to Holding Bucket
    const newAchievements = await checkAndUnlock(user._id.toString())
    res.json({ gold: newGold, added: amount, newAchievements })
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
    
    res.json({
      gold: user.gold,
      metal: user.metal,
      rank: user.rank,
      xp: user.xp,
      wagerCap: user.wagerCap
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
