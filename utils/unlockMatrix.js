/**
 * GDD 21: Hierarchy of Restoration - one Unlock function by Gold and Metal (and Rank).
 */
import { getEconomyConfig } from '../config/economy.js'

const FALLBACK = {
  workbench: { unlockCostGold: 50, unlockCostMetal: 0, requiredRank: null },
  power_core: { unlockCostGold: 10, unlockCostMetal: 0, requiredRank: null },
  ai_oracle: { unlockCostGold: 0, unlockCostMetal: 0, requiredRank: 1 },
  memo_printer: { unlockCostGold: 40, unlockCostMetal: 0, requiredRank: null }
}

function getMatrix() {
  try {
    const c = getEconomyConfig()
    return c.resourceUpgradeMatrix && typeof c.resourceUpgradeMatrix === 'object'
      ? { ...FALLBACK, ...c.resourceUpgradeMatrix }
      : FALLBACK
  } catch {
    return FALLBACK
  }
}

export function canUnlock(assetId, goldBalance, metalBalance, rank) {
  const m = getMatrix()
  const a = m[assetId]
  if (!a) return false
  const gold = Number(goldBalance) || 0
  const metal = Number(metalBalance) || 0
  const r = Number(rank) || 0
  if (a.requiredRank != null && r < a.requiredRank) return false
  if ((a.unlockCostGold || 0) > gold) return false
  if ((a.unlockCostMetal || 0) > metal) return false
  return true
}

export function getUnlockCost(assetId) {
  const a = getMatrix()[assetId]
  if (!a) return { gold: 0, metal: 0, requiredRank: null }
  return { gold: a.unlockCostGold || 0, metal: a.unlockCostMetal || 0, requiredRank: a.requiredRank ?? null }
}
