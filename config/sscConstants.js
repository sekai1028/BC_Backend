/**
 * SSC economy — single balance `sscBalance` (see User model).
 * - Master clock: every 10s while user is on site → +SSC_PER_10S_SITE_IDLE
 * - Chart round end: REPORT only — time_elapsed_sec × SSC_PER_SECOND_ROUND (no extra credit; idle already ticked)
 * - Video ad complete: +SSC_VIDEO_AD_REWARD (×2 if propagandaFilter shop item)
 */
export const SSC_PER_SECOND_ROUND = 0.0000066
/** Master 10s tick — incremental “dopamine” clock */
export const SSC_PER_10S_SITE_IDLE = 0.000066
export const SSC_VIDEO_AD_REWARD = 0.002
