/**
 * GDD 20: Economy config — external variables so Owner can adjust without redeploy.
 * Reads from config/economy.json; admin dashboard can PATCH to update.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, 'economy.json')

const DEFAULTS = {
  adReward: { base: 1.0, rankMultiplier: 0.05 },
  emergencySiphon: { rank0Amount: 4.0, base: 2.0, rankMultiplier: 0.1 },
  vaultLevels: [
    { level: 1, wagerCap: 2, upgradeCostGold: null, requiredRank: null },
    { level: 2, wagerCap: 5, upgradeCostGold: 25, requiredRank: 2 },
    { level: 3, wagerCap: 10, upgradeCostGold: 100, requiredRank: 5 },
    { level: 4, wagerCap: 25, upgradeCostGold: 250, requiredRank: 10 },
    { level: 5, wagerCap: 50, upgradeCostGold: 500, requiredRank: 15 },
    { level: 6, wagerCap: 100, upgradeCostGold: 1000, requiredRank: 20 },
    { level: 7, wagerCap: 150, upgradeCostGold: 1500, requiredRank: 25 },
    { level: 8, wagerCap: 200, upgradeCostGold: 2000, requiredRank: 30 },
    { level: 9, wagerCap: 500, upgradeCostGold: 5000, requiredRank: 40 },
    { level: 10, wagerCap: 1000, upgradeCostGold: 10000, requiredRank: 50 }
  ],
  xpPerRank: [0, 40, 100, 200, 400, 800, 1600, 3200, 6400, 12800]
}

let cache = null

function deepMerge(target, source) {
  const out = { ...target }
  for (const key of Object.keys(source || {})) {
    if (source[key] != null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] || {}, source[key])
    } else if (source[key] !== undefined) {
      out[key] = source[key]
    }
  }
  return out
}

/** Load config from file (with cache); falls back to defaults if file missing/invalid. */
export function getEconomyConfig() {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    cache = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), parsed)
    return cache
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULTS))
    return cache
  }
}

/** Invalidate cache so next getEconomyConfig() reads from file. */
export function invalidateEconomyCache() {
  cache = null
}

/** Write config to file (admin dashboard). Merges with current so partial updates work. */
export function setEconomyConfig(updates) {
  const current = getEconomyConfig()
  const next = deepMerge(JSON.parse(JSON.stringify(current)), updates)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8')
  invalidateEconomyCache()
  return getEconomyConfig()
}

/** Standard ad reward by rank (GDD 4.2). Uses config. */
export function standardAdRewardByRank(rank) {
  const c = getEconomyConfig().adReward
  return (c?.base ?? 1) * (1 + (rank || 0) * (c?.rankMultiplier ?? 0.05))
}

/** Emergency siphon reward (GDD 4.3). Uses config. */
export function emergencySiphonRewardByRank(rank) {
  const c = getEconomyConfig().emergencySiphon
  if (rank === 0) return c?.rank0Amount ?? 4.0
  return (c?.base ?? 2) * (1 + rank * (c?.rankMultiplier ?? 0.1))
}

/** Vault config by level (1–10). Uses config. */
export function getVaultConfigFromEconomy(level) {
  const levels = getEconomyConfig().vaultLevels || DEFAULTS.vaultLevels
  const l = Math.max(1, Math.min(10, Math.floor(level) || 1))
  return levels[l - 1] || levels[0]
}

/** XP thresholds per rank (for getRankFromXP). Uses config. */
export function getXpPerRankFromEconomy() {
  return getEconomyConfig().xpPerRank || DEFAULTS.xpPerRank
}
