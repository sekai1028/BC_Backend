/**
 * Ensure all MongoDB collections and indexes exist.
 * Run after mongoose.connect() so "tables" are created.
 *
 * Collections created:
 *   users       - User accounts (auth, profile, gold, etc.)
 *   rounds      - Game rounds (wager, multiplier, status)
 *   mercypot    - Global mercy pot (singleton)
 *   chatmessages - Global chat messages
 */
import User from '../models/User.js'
import Round from '../models/Round.js'
import MercyPot from '../models/MercyPot.js'
import ChatMessage from '../models/ChatMessage.js'
import CryptoDeposit from '../models/CryptoDeposit.js'
import CryptoWithdraw from '../models/CryptoWithdraw.js'
import LeaderboardEntry from '../models/LeaderboardEntry.js'
import ChatReport from '../models/ChatReport.js'
import SupportRequest from '../models/SupportRequest.js'

const models = [User, Round, MercyPot, ChatMessage, CryptoDeposit, CryptoWithdraw, LeaderboardEntry, ChatReport, SupportRequest]

export async function ensureCollections() {
  for (const Model of models) {
    try {
      await Model.createCollection()
    } catch (err) {
      if (err.code === 48 || /already exists/i.test(err.message || '')) {
        // Collection already exists, continue
      } else {
        console.warn(`  createCollection ${Model.collection.name}:`, err.message)
      }
    }
    try {
      await Model.syncIndexes()
      console.log(`  Collection ready: ${Model.collection.name}`)
    } catch (err) {
      console.warn(`  syncIndexes ${Model.collection.name}:`, err.message)
    }
  }
}
