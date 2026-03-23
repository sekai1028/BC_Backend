/**
 * GDD 8.1 Siphon Core (idle rate) + 8.2 Pattern Overclock (ceiling/floor).
 * Level 0 = no Oracle uplink — passive Gold tick is 0 until upgraded to Level 1+.
 * Row index === level (0..10). upgradeGold on row L = cost Gold to advance L → L+1 (null at max).
 */

export const ORACLE_LEVELS = [
  { level: 0, idleRatePer10s: 0, ceiling: 50, floor: -0.5, upgradeGold: 0, upgradeMetal: null },
  { level: 1, idleRatePer10s: 0.0001, ceiling: 50, floor: -0.5, upgradeGold: 50, upgradeMetal: 20 },
  { level: 2, idleRatePer10s: 0.0005, ceiling: 50, floor: -0.5, upgradeGold: 100, upgradeMetal: 50 },
  { level: 3, idleRatePer10s: 0.001, ceiling: 50, floor: -0.5, upgradeGold: 250, upgradeMetal: 150 },
  { level: 4, idleRatePer10s: 0.0025, ceiling: 50, floor: -0.5, upgradeGold: 500, upgradeMetal: 300 },
  { level: 5, idleRatePer10s: 0.005, ceiling: 50, floor: -0.5, upgradeGold: 750, upgradeMetal: 500 },
  { level: 6, idleRatePer10s: 0.0075, ceiling: 50, floor: -0.5, upgradeGold: 1200, upgradeMetal: 800 },
  { level: 7, idleRatePer10s: 0.01, ceiling: 50, floor: -0.6, upgradeGold: 2500, upgradeMetal: 1500 },
  { level: 8, idleRatePer10s: 0.015, ceiling: 50, floor: -0.8, upgradeGold: 5000, upgradeMetal: 3000 },
  { level: 9, idleRatePer10s: 0.02, ceiling: 50, floor: -1.0, upgradeGold: 10000, upgradeMetal: 7500 },
  { level: 10, idleRatePer10s: 0.025, ceiling: 50, floor: -1.2, upgradeGold: null, upgradeMetal: null }
]

/** Config for chart volatility (GDD): Level 0 uses Level 1 curve. */
export function getOracleConfig(level) {
  const raw = Math.floor(Number(level))
  const l = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) : 0
  const chartLevel = Math.max(1, l)
  return ORACLE_LEVELS[chartLevel] || ORACLE_LEVELS[1]
}

/** Passive gold per 10s; 0 when base tier &lt; 1. `level` should be effective tier (base + mod), capped elsewhere. */
export function getIdleRatePer10s(level) {
  const l = Math.floor(Number(level)) || 0
  if (l < 1) return 0
  const capped = Math.min(10, l)
  const row = ORACLE_LEVELS[capped]
  return row ? row.idleRatePer10s : 0
}

export function getCeiling(level) {
  return getOracleConfig(level).ceiling
}

export function getFloor(level) {
  return getOracleConfig(level).floor
}
