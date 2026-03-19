/**
 * GDD 8.1 Siphon Core (idle rate) + 8.2 Pattern Overclock (ceiling/floor).
 * Section 2.2: Wobble path can reach Standard Win 1.5x–5x, Deep Run 5x–19.9x, God Run 20x+ — no 1.5x cap.
 */

export const ORACLE_LEVELS = [
  { level: 1, idleRatePer10s: 0.0001, ceiling: 50, floor: -0.5, upgradeGold: null, upgradeMetal: null },
  { level: 2, idleRatePer10s: 0.0005, ceiling: 50, floor: -0.5, upgradeGold: 50, upgradeMetal: 20 },
  { level: 3, idleRatePer10s: 0.001, ceiling: 50, floor: -0.5, upgradeGold: 100, upgradeMetal: 50 },
  { level: 4, idleRatePer10s: 0.0025, ceiling: 50, floor: -0.5, upgradeGold: 250, upgradeMetal: 150 },
  { level: 5, idleRatePer10s: 0.005, ceiling: 50, floor: -0.5, upgradeGold: 500, upgradeMetal: 300 },
  { level: 6, idleRatePer10s: 0.0075, ceiling: 50, floor: -0.5, upgradeGold: 750, upgradeMetal: 500 },
  { level: 7, idleRatePer10s: 0.01, ceiling: 50, floor: -0.6, upgradeGold: 1200, upgradeMetal: 800 },
  { level: 8, idleRatePer10s: 0.015, ceiling: 50, floor: -0.8, upgradeGold: 2500, upgradeMetal: 1500 },
  { level: 9, idleRatePer10s: 0.02, ceiling: 50, floor: -1.0, upgradeGold: 5000, upgradeMetal: 3000 },
  { level: 10, idleRatePer10s: 0.025, ceiling: 50, floor: -1.2, upgradeGold: 10000, upgradeMetal: 7500 }
]

export function getOracleConfig(level) {
  const l = Math.max(1, Math.min(10, Math.floor(level) || 1))
  return ORACLE_LEVELS[l - 1] || ORACLE_LEVELS[0]
}

export function getIdleRatePer10s(level) {
  return getOracleConfig(level).idleRatePer10s
}

export function getCeiling(level) {
  return getOracleConfig(level).ceiling
}

export function getFloor(level) {
  return getOracleConfig(level).floor
}
