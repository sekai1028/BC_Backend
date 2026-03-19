/**
 * GDD 19: Check criteria and unlock achievements; return newly unlocked for toast.
 */
import User from '../models/User.js'
import { checkAchievementCriteria, unlockAchievements } from '../utils/achievements.js'

/**
 * After caller has updated and saved user, check criteria and unlock any new achievements.
 * @param {string} userId - User _id
 * @returns {Promise<string[]>} Newly unlocked achievement IDs
 */
export async function checkAndUnlock(userId) {
  const user = await User.findById(userId)
  if (!user) return []
  const newly = checkAchievementCriteria(user)
  if (newly.length === 0) return []
  const unlocked = await unlockAchievements(User, userId, newly)
  return unlocked
}

/**
 * Check achievements without updating user. Returns IDs that qualify but are not yet in user.achievements.
 */
export function getQualifiedButLocked(user) {
  return checkAchievementCriteria(user)
}

export { ACHIEVEMENT_LIST } from '../utils/achievements.js'
