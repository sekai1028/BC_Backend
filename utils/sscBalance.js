/**
 * Canonical SSC balance: `sscBalance`, fallback to legacy `metal`.
 */
export function getSscBalance(doc) {
  if (!doc) return 0
  const sb = doc.sscBalance
  if (sb != null && Number.isFinite(Number(sb))) return Number(sb)
  return Number(doc.metal) || 0
}
