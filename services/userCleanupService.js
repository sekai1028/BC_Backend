import User from '../models/User.js'
import LeaderboardEntry from '../models/LeaderboardEntry.js'

/**
 * Remove users who have been inactive for longer than USER_CLEANUP_INACTIVE_DAYS,
 * and/or unverified users created more than USER_CLEANUP_UNVERIFIED_DAYS ago.
 * Also deletes their leaderboard entries.
 */

const INACTIVE_DAYS = Number(process.env.USER_CLEANUP_INACTIVE_DAYS) || 365
const UNVERIFIED_DAYS = Number(process.env.USER_CLEANUP_UNVERIFIED_DAYS) || 30
const CLEANUP_INTERVAL_MS = Number(process.env.USER_CLEANUP_INTERVAL_MS) || 24 * 60 * 60 * 1000 // 24h

export function getCleanupConfig() {
  return {
    inactiveDays: INACTIVE_DAYS,
    unverifiedDays: UNVERIFIED_DAYS,
    intervalMs: CLEANUP_INTERVAL_MS
  }
}

/**
 * Find user IDs to remove:
 * - Inactive: lastSeen older than INACTIVE_DAYS
 * - Unverified: verified === false and createdAt older than UNVERIFIED_DAYS
 */
async function findUsersToRemove() {
  const now = new Date()
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * 24 * 60 * 60 * 1000)
  const unverifiedCutoff = new Date(now.getTime() - UNVERIFIED_DAYS * 24 * 60 * 60 * 1000)

  const inactive = await User.find(
    { lastSeen: { $lt: inactiveCutoff } },
    { _id: 1 }
  ).lean()

  const unverified = await User.find(
    { verified: false, createdAt: { $lt: unverifiedCutoff } },
    { _id: 1 }
  ).lean()

  const inactiveIds = new Set(inactive.map((u) => u._id.toString()))
  const unverifiedIds = new Set(unverified.map((u) => u._id.toString()))
  const allIds = new Set([...inactiveIds, ...unverifiedIds])
  return Array.from(allIds)
}

/**
 * Delete a user and their leaderboard entry. Returns { deletedUser, deletedLeaderboard }.
 */
async function removeUser(userId) {
  const id = typeof userId === 'string' ? userId : userId?.toString?.()
  if (!id) return { deletedUser: false, deletedLeaderboard: false }

  const deletedLeaderboard = (await LeaderboardEntry.deleteOne({ source: 'user', userId: id })).deletedCount > 0
  const deletedUser = (await User.deleteOne({ _id: id })).deletedCount > 0
  return { deletedUser, deletedLeaderboard }
}

/**
 * Run one cleanup pass. Returns { removed, errors }.
 */
export async function runCleanup() {
  const results = { removed: 0, errors: [] }
  let userIds
  try {
    userIds = await findUsersToRemove()
  } catch (err) {
    results.errors.push({ step: 'findUsersToRemove', message: err.message })
    return results
  }

  for (const id of userIds) {
    try {
      const { deletedUser } = await removeUser(id)
      if (deletedUser) results.removed += 1
    } catch (err) {
      results.errors.push({ userId: id, message: err.message })
    }
  }

  if (results.removed > 0 || results.errors.length > 0) {
    console.log('[userCleanup] run complete', { removed: results.removed, errors: results.errors.length })
    if (results.errors.length > 0) {
      console.error('[userCleanup] errors', results.errors)
    }
  }
  return results
}

/**
 * Start the periodic cleanup (runs after initial delay, then every CLEANUP_INTERVAL_MS).
 * Returns a function to stop the interval.
 */
export function startScheduledCleanup(options = {}) {
  const { initialDelayMs = 60 * 1000 } = options // 1 min after startup by default
  let intervalId = null
  let timeoutId = null

  const run = () => {
    runCleanup().catch((err) => {
      console.error('[userCleanup] scheduled run failed', err.message)
    })
  }

  timeoutId = setTimeout(() => {
    run()
    intervalId = setInterval(run, CLEANUP_INTERVAL_MS)
  }, initialDelayMs)

  return function stop() {
    if (timeoutId) clearTimeout(timeoutId)
    if (intervalId) clearInterval(intervalId)
    timeoutId = null
    intervalId = null
  }
}
