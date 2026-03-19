/**
 * GDD: Tiered in-round headline pools (Purple headline overlay).
 * Tier 1 (0–50%): Engagement — humor, world building. Tier 2 (50–85%): Psychology — tension.
 * Tier 3 (85–90%): Skill — end signal. Tier 4: Anomaly — chaos, 4th wall.
 * Vertical: Syndicate, Wasteland, Technical/AI, Resistance.
 */

/** Tier 1: Safe (0–50%) — Make the player laugh. Wasteland + Syndicate. */
const TIER_1 = [
  "ARCHAEOLOGY: Ancient 'Blue Checkmark' found in rubble. Research suggests it was a mark of high-status jesters.",
  "ARCHAEOLOGY: Recovered 'Shiba Inu' meme. Oracle classifies it as a 21st-century religious icon.",
  "ARCHAEOLOGY: 'NFT' fragment discovered. Believed to be early Syndicate loyalty points.",
  "SYNDICATE_MSG: Mandatory 'Efficiency Report' due. Please describe your productivity in 3 words or less.",
  "SYNDICATE_MSG: Moisture tax increased by 2%. Your bunker's humidity is now a premium feature.",
  "BUNKER_GOSSIP: Rumor: The Consensus was originally a weather app. It still thinks you're a cloud.",
  "BUNKER_GOSSIP: Scavenger tip: If you find a 'Twitter' logo, do not eat it. It is not candy.",
  "ORACLE: The AI Oracle is bored. It has calculated 10,000 ways to say 'connection stable.'",
  "ORACLE: System status: Mundane. The Oracle has no strong feelings about the current run.",
  "WASTELAND: Found a 'Tesla' charging cable. The Oracle suggests it was used to power 'hopes and dreams.'",
  "WASTELAND: Recovered 'Crypto' wallet. Balance: 0.00. Status: Historically accurate.",
  "SYNDICATE_MSG: Friendly reminder: Your 'optional' donation to Vector-Dayton is still optional. (It is not optional.)",
  "RECOVERY: Found a 'Santa Claus' suit. Oracle assumes this was the Syndicate CEO's winter combat gear.",
]

/** Tier 2: Caution (50–85%) — Build paranoia. Technical + Resistance. */
const TIER_2 = [
  "SIGNAL_STRESS: The Oracle's fans are spinning at 10,000 RPM. Something big is coming.",
  "SIGNAL_STRESS: Encryption layers fluctuating. Syndicate sweep may be approaching.",
  "TECH: Hardware stress detected. Uplink stability at 78% and dropping.",
  "TECH: Background noise detected. Stay alert for incoming terminal headlines.",
  "SYNDICATE_MSG: Tracking signal 88-Beta... Exile detected... Pursuing liquidation.",
  "RESISTANCE: Enforcer patrol sighted in Sector 7. Mask your signal.",
  "RESISTANCE: Multiple exiles detected in the frequency. You are not alone in the dark.",
  "TECH: Signal intensity increasing. The Oracle recommends not panicking. (Yet.)",
  "SYNDICATE_MSG: Audit in progress. Please remain calm. Calm exiles are easier to process.",
  "TECH: Overheating detected. The Oracle suggests you consider your life choices.",
  "RESISTANCE: Bunker heat rising. Syndicate trace may be imminent.",
  "SIGNAL_STRESS: Proximity alert. Unknown signature approaching your sector.",
  "TECH: Flickering detected. Either a hardware glitch or something worse.",
]

/** Tier 3: Critical (85–90%) — Signal the end. Syndicate Liquidation + Technical Critical. */
const TIER_3 = [
  "MARGIN_CALL: The Auditor has entered your sector. Uplink cut in 3... 2...",
  "CRITICAL: Syndicate Trace imminent. Fold now or forfeit.",
  "LIQUIDATION_PROTOCOL: Vault seizure authorized. Resistance is a line item.",
  "ORACLE_PANIC: Critical logic error. The Oracle has seen this before. It did not end well.",
  "SYNDICATE_MSG: Liquidation protocols engaged. Thank you for your contribution to the Whole.",
  "TECH: Critical error. The Oracle suggests folding. The Oracle is rarely wrong about this.",
  "VAULT_SEIZURE: Your credits have been reclassified as 'donation.' Have a nice day.",
  "WARNING: Security sweep detected. Fold or be folded.",
  "ALERT: Uplink compromise in progress. Countdown to zero: unknown.",
  "SYNDICATE_MSG: Congratulations. You have been selected for Mandatory Wealth Redistribution. (You are the donor.)",
]

/** Tier 4: Anomaly (random) — Chaos, 4th wall, pattern breaker. */
const TIER_4 = [
  "ERROR_707: I can see your webcam, Exile. You look nervous.",
  "ANOMALY: The Oracle has forgotten why it exists. It will continue anyway.",
  "ERROR_404: Freedom not found. Please reboot your expectations.",
  "ANOMALY: The fourth wall has been breached. Please do not look behind you.",
  "ORACLE: The Oracle is judging your lack of commitment. (It is always judging.)",
  "ERROR_0: Division by hope. Result: undefined.",
  "ANOMALY: This message was not meant for you. Or was it?",
  "SYNDICATE_MSG: Unauthorized hope detected in Sector 7. Please report for a reality check.",
  "ORACLE: The Oracle has calculated the meaning of life. It is not sharing.",
  "ANOMALY: If you are reading this, the run has already ended. Or has it?",
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0]
}

export function getHeadlineForTier(tier, isBluff = false) {
  if (tier === 3 && isBluff) return pickRandom(TIER_1)
  if (tier === 4) return pickRandom(TIER_4)
  if (tier === 1) return pickRandom(TIER_1)
  if (tier === 2) return pickRandom(TIER_2)
  if (tier === 3) return pickRandom(TIER_3)
  return pickRandom(TIER_1)
}

export { TIER_1, TIER_2, TIER_3, TIER_4 }
