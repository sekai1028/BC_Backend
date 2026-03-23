/**
 * GDD 19: Achievement List — Individual achievements (Completionist Path).
 * IDs are stored in User.achievements; criteria checked here.
 */

export const ACHIEVEMENT_LIST = [
  { id: 'first_siphon', name: 'First Siphon', description: 'Watch your first ad.' },
  { id: 'true_believer', name: 'True Believer', description: 'Watch 100 ads.' },
  { id: 'ad_dict', name: 'Ad-Dict', description: 'Watch 1,000 ads.' },
  { id: 'paper_hands', name: 'Paper Hands', description: 'Fold in the Green 50 times.' },
  { id: 'double_tap', name: 'Double Tap', description: 'Fold in the green 2 times.' },
  { id: 'iron_guts', name: 'Iron Guts', description: 'Hold past a 3.0x multiplier.' },
  { id: 'diamond_soul', name: 'Diamond Soul', description: 'Hold past a 10.0x multiplier.' },
  { id: 'the_god_run', name: 'The God Run', description: 'Successfully fold at 20.0x or higher.' },
  { id: 'the_survivor', name: 'The Survivor', description: 'Recover from $0.0001 balance to $1.0 without buying any Gold.' },
  { id: 'uplink_stable', name: 'Uplink Stable', description: 'Stay online for 2 hours straight.' },
  { id: 'ghost_in_the_machine', name: 'Ghost in the Machine', description: 'Stay online for 24 hours straight.' },
  { id: 'ghost_of_the_terminal', name: 'The Ghost of the Terminal', description: 'Stay online/active for 48 aggregate hours.' },
  { id: 'silent_donor', name: 'Silent Donor', description: 'Donate $1.00 to the Mercy Pot without receiving Gold.' },
  { id: 'the_whale_hunter', name: 'The Whale Hunter', description: 'Wager the maximum allowed cap 10 times in a row.' },
  { id: 'system_shock', name: 'System Shock', description: 'Crash out 10 times.' },
  { id: 'margin_walker', name: 'Margin Walker', description: 'Go Bankrupt once (Balance hits 0).' },
  { id: 'dead_reckoning', name: 'Dead Reckoning', description: 'Go Bankrupt twice.' },
  { id: 'blood_oath', name: 'Blood Oath', description: 'Reach Rank 50 (Unlocks the Syndicate Sigil).' },
  { id: 'insider_trading', name: 'Insider Trading', description: 'Hold a balance of over 50,000 Gold simultaneously.' },
  { id: 'oracle_master', name: 'Oracle Master', description: 'Max out the AI Oracle (Level 10) in the Holophone.' },
  { id: 'syndicate_nightmare', name: 'Syndicate Nightmare', description: 'Reach a lifetime Total Siphoned of 1,000,000 Gold.' }
]

const BY_ID = Object.fromEntries(ACHIEVEMENT_LIST.map((a) => [a.id, a]))

export function getAchievementDefinition(id) {
  return BY_ID[id] || null
}

/** Returns which achievement IDs the user has not yet unlocked but now qualifies for. */
export function checkAchievementCriteria(user) {
  if (!user) return []
  const unlocked = new Set(Array.isArray(user.achievements) ? user.achievements : [])
  const newly = []

  const ads = Number(user.adsWatched) || 0
  const roundsWon = Number(user.roundsWon) || 0
  const maxMult = Number(user.maxMultiplierReached) || 1
  const timesCrashed = Number(user.timesCrashed) || 0
  const timesBankrupt = Number(user.timesBankrupt) || 0
  const rank = Number(user.rank) || 0
  const gold = Number(user.gold) || 0
  const oracleLevel = (Number(user.oracleLevel) || 0) + (Number(user.oracleMod) || 0)
  const totalSiphoned = Number(user.totalSiphoned) || 0
  const bestMaxWager = Number(user.bestConsecutiveMaxWager) || 0
  const totalSeconds = Number(user.totalSecondsOnline) || 0
  const mercyDonated = Number(user.mercyDonatedWithoutGold) || 0
  const recovered = !!user.recoveredTo1WithoutBuying
  const sessionStart = user.sessionStartedAt ? new Date(user.sessionStartedAt).getTime() : 0
  const now = Date.now()
  const sessionSeconds = sessionStart > 0 ? (now - sessionStart) / 1000 : 0

  if (ads >= 1 && !unlocked.has('first_siphon')) newly.push('first_siphon')
  if (ads >= 100 && !unlocked.has('true_believer')) newly.push('true_believer')
  if (ads >= 1000 && !unlocked.has('ad_dict')) newly.push('ad_dict')
  if (roundsWon >= 50 && !unlocked.has('paper_hands')) newly.push('paper_hands')
  if (roundsWon >= 2 && !unlocked.has('double_tap')) newly.push('double_tap')
  if (maxMult >= 3.0 && !unlocked.has('iron_guts')) newly.push('iron_guts')
  if (maxMult >= 10.0 && !unlocked.has('diamond_soul')) newly.push('diamond_soul')
  if (maxMult >= 20.0 && !unlocked.has('the_god_run')) newly.push('the_god_run')
  if (recovered && !unlocked.has('the_survivor')) newly.push('the_survivor')
  if (sessionSeconds >= 2 * 3600 && !unlocked.has('uplink_stable')) newly.push('uplink_stable')
  if (sessionSeconds >= 24 * 3600 && !unlocked.has('ghost_in_the_machine')) newly.push('ghost_in_the_machine')
  if (totalSeconds >= 48 * 3600 && !unlocked.has('ghost_of_the_terminal')) newly.push('ghost_of_the_terminal')
  if (mercyDonated >= 1.0 && !unlocked.has('silent_donor')) newly.push('silent_donor')
  if (bestMaxWager >= 10 && !unlocked.has('the_whale_hunter')) newly.push('the_whale_hunter')
  if (timesCrashed >= 10 && !unlocked.has('system_shock')) newly.push('system_shock')
  if (timesBankrupt >= 1 && !unlocked.has('margin_walker')) newly.push('margin_walker')
  if (timesBankrupt >= 2 && !unlocked.has('dead_reckoning')) newly.push('dead_reckoning')
  if (rank >= 50 && !unlocked.has('blood_oath')) newly.push('blood_oath')
  if (gold >= 50000 && !unlocked.has('insider_trading')) newly.push('insider_trading')
  if (oracleLevel >= 10 && !unlocked.has('oracle_master')) newly.push('oracle_master')
  if (totalSiphoned >= 1000000 && !unlocked.has('syndicate_nightmare')) newly.push('syndicate_nightmare')

  return newly
}

/** Add achievement IDs to user and return the list that was newly added. */
export async function unlockAchievements(User, userId, achievementIds) {
  if (!achievementIds || achievementIds.length === 0) return []
  const user = await User.findById(userId)
  if (!user) return []
  const current = new Set(Array.isArray(user.achievements) ? user.achievements : [])
  const toAdd = achievementIds.filter((id) => !current.has(id))
  if (toAdd.length === 0) return []
  user.achievements = [...(user.achievements || []), ...toAdd]
  await user.save()
  return toAdd
}
