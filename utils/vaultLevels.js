/**
 * GDD 8 + 20: Vault (Trading License) — wager cap by level. Uses economy config when available.
 */
import { getEconomyConfig, getVaultConfigFromEconomy } from '../config/economy.js'

const FALLBACK_LEVELS = [
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
]

function getLevels() {
  try {
    const levels = getEconomyConfig().vaultLevels
    return Array.isArray(levels) && levels.length >= 10 ? levels : FALLBACK_LEVELS
  } catch {
    return FALLBACK_LEVELS
  }
}

export const VAULT_LEVELS = FALLBACK_LEVELS

export function getVaultConfig(level) {
  try {
    return getVaultConfigFromEconomy(level)
  } catch {
    const l = Math.max(1, Math.min(10, Math.floor(level) || 1))
    return FALLBACK_LEVELS[l - 1] || FALLBACK_LEVELS[0]
  }
}

export function getWagerCap(level) {
  return getVaultConfig(level).wagerCap
}

export function getNextVaultUpgrade(currentLevel) {
  if (currentLevel >= 10) return null
  const levels = getLevels()
  return levels[currentLevel] || null
}

export function getVaultUpgradeInfo(currentLevel) {
  const next = getNextVaultUpgrade(currentLevel)
  if (!next) return null
  return {
    nextLevel: next.level,
    wagerCap: next.wagerCap,
    costGold: next.upgradeCostGold,
    requiredRank: next.requiredRank
  }
}
