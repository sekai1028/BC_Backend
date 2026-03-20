/**
 * Global Chat — blocked terms (server-side only).
 * Whole-word matching (\b) reduces false positives like "class" / "bass".
 * Optional env CHAT_BLOCKED_WORDS=comma,separated,extras (merged with defaults).
 */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Core vulgar / slur list — extend via CHAT_BLOCKED_WORDS in .env */
const DEFAULT_BLOCKED_WORDS = [
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bastard',
  'asshole',
  'dick',
  'dickhead',
  'cock',
  'cocksucker',
  'pussy',
  'cunt',
  'slut',
  'whore',
  'cum',
  'jizz',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'retarded',
  'chink',
  'gook',
  'kike',
  'spic',
  'wetback',
  'coon',
  'rape',
  'rapist',
]

export function getBlockedWordList() {
  const env = process.env.CHAT_BLOCKED_WORDS
  const extra = env
    ? env
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean)
    : []
  return [...new Set([...DEFAULT_BLOCKED_WORDS, ...extra])]
}

/**
 * @param {string} raw
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function chatTextPassesFilter(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) {
    return { ok: false, error: 'Message is empty.' }
  }
  const lower = text.toLowerCase()
  for (const word of getBlockedWordList()) {
    if (!word || word.length < 2) continue
    try {
      const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i')
      if (re.test(lower)) {
        return {
          ok: false,
          error: "That language isn’t allowed in Global Chat.",
        }
      }
    } catch {
      /* invalid regex from env word — skip */
    }
  }
  return { ok: true }
}
