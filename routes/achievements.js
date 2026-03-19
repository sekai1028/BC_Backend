import express from 'express'
import { ACHIEVEMENT_LIST } from '../utils/achievements.js'

const router = express.Router()

/** GET /api/achievements — GDD 19: List of all achievement definitions (id, name, description) */
router.get('/', (req, res) => {
  res.json({ achievements: ACHIEVEMENT_LIST })
})

export default router
