/**
 * GDD 5.2: Hard Cap on production speeds.
 * Total_Production = Base_Rate × (1.0 + Shop_Mod + Ad_Mod)
 * Max Shop Mod: +2.0, Max Ad Mod: +1.0. Final_Speed = Math.min(Total_Production, 5.0)
 */

const HARD_CAP = 5.0

/**
 * @param {number} baseRate - Base rate (1.0)
 * @param {number} shopMod - From permanent shop boosts (metalMod or oracleMod), max +2
 * @param {number} adMod - From ad overclock (e.g. 30m), max +1
 * @returns {number} Capped speed, max 5.0
 */
export function cappedProductionSpeed(baseRate = 1.0, shopMod = 0, adMod = 0) {
  const total = baseRate * (1.0 + (Number(shopMod) || 0) + (Number(adMod) || 0))
  return Math.min(total, HARD_CAP)
}

export { HARD_CAP }
