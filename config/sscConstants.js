/**
 * SSC economy — single balance `sscBalance` (see User model).
 *
 * Chart round (Terminal) — success banner / fold report:
 *   SSC_Earned = Seconds_Played × SSC_PER_SECOND_ROUND
 *   Example: 30s × 0.0000066 = 0.000198 SSC
 *   (Developer note: 0.0004 SSC/min ≈ 0.00000667/s; design uses 0.0000066/s for the chart formula.)
 *
 * Idling on chart terminal page (site presence tick):
 *   SSC_PER_MINUTE_TERMINAL_IDLE = 0.00040 SSC/min → each 10s tick adds that × (10/60).
 *
 * Video ad (Propaganda Siphon): +SSC_VIDEO_AD_REWARD (×2 if propagandaFilter shop item)
 */
/** Idle rate for chart rounds: SSC per second of time in run */
export const SSC_PER_SECOND_ROUND = 0.0000066
/** Passive accrual while on site (terminal page presence) */
export const SSC_PER_MINUTE_TERMINAL_IDLE = 0.0004
/** Amount added each economy tick (10s at default SITE_ECONOMY_TICK_MS) — scales with tick interval in server.js */
export const SSC_PER_10S_SITE_IDLE = (SSC_PER_MINUTE_TERMINAL_IDLE * 10) / 60
export const SSC_VIDEO_AD_REWARD = 0.002
