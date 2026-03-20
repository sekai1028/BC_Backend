import ChatMessage from '../models/ChatMessage.js'
import User from '../models/User.js'
import { chatTextPassesFilter } from '../config/chatFilter.js'

const MAX_CHAT_LEN = 200

class ChatService {
  validateOutgoingText(raw) {
    const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_CHAT_LEN) : ''
    const check = chatTextPassesFilter(text)
    if (!check.ok) {
      throw new Error(check.error || 'Message not allowed.')
    }
    return text
  }

  async sendMessage(data) {
    const { userId, username, rank, message } = data
    if (userId) {
      const user = await User.findById(userId).select('bannedFromChat').lean()
      if (user?.bannedFromChat) {
        throw new Error('You are banned from Global Chat.')
      }
    }
    const safeText = this.validateOutgoingText(message)

    const chatMessage = await ChatMessage.create({
      userId,
      username,
      rank,
      message: safeText,
      standing: 0 // TODO: Calculate standing
    })

    return this.formatMessage({
      _id: chatMessage._id,
      userId: chatMessage.userId,
      username,
      rank,
      message: safeText,
      isSystem: false,
      createdAt: chatMessage.createdAt,
    })
  }

  getStandingColor(standing) {
    const colors = {
      5: '#FF00FF', // Rainbow (Bunker Hero)
      4: '#FFD700', // Gold (Elite Operator)
      3: '#00BFFF', // Blue (Field Agent)
      2: '#9370DB', // Purple (Contributor)
      1: '#FFFFFF', // White (Scavenger)
      0: '#808080'  // Grey (Prospect)
    }
    return colors[standing] || colors[0]
  }

  /** Format a stored message for API/socket: id, username, text, time, rank, isSystem, userId */
  formatMessage(doc) {
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date()
    const now = Date.now()
    const diffMs = now - createdAt.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    let timeStr
    if (diffMins < 1) timeStr = 'now'
    else if (diffMins < 60) timeStr = `${diffMins}m`
    else if (diffHours < 24) timeStr = `${diffHours}h`
    else timeStr = `${diffDays}d`
    return {
      id: doc._id?.toString(),
      userId: doc.userId?._id?.toString() || doc.userId?.toString() || null,
      username: doc.username || doc.userId?.username || '?',
      text: doc.message,
      time: timeStr,
      createdAt: doc.createdAt,
      rank: doc.rank ?? 0,
      isSystem: !!doc.isSystem,
    }
  }

  async getRecentMessages(limit = 50) {
    const docs = await ChatMessage.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'username rank')
      .lean()
    return docs.reverse().map((d) => this.formatMessage(d))
  }

  /** Update a message; only the owner can update. Returns formatted message or null. */
  async updateMessage(messageId, userId, newText) {
    const msg = await ChatMessage.findById(messageId).lean()
    if (!msg) return null
    const ownerId = msg.userId?.toString?.() ?? String(msg.userId)
    if (ownerId !== String(userId)) return null
    const filtered = this.validateOutgoingText(newText)
    const updated = await ChatMessage.findByIdAndUpdate(
      messageId,
      { message: filtered },
      { new: true }
    ).lean()
    return updated ? this.formatMessage(updated) : null
  }

  /** Delete a message; only the owner can delete. Returns true if deleted. */
  async deleteMessage(messageId, userId) {
    const msg = await ChatMessage.findById(messageId).lean()
    if (!msg) return false
    const ownerId = msg.userId?.toString?.() ?? String(msg.userId)
    if (ownerId !== String(userId)) return false
    await ChatMessage.findByIdAndDelete(messageId)
    return true
  }

  /** Moderation: delete any message by id (admin only — route must enforce). */
  async deleteMessageAdmin(messageId) {
    const msg = await ChatMessage.findById(messageId).lean()
    if (!msg) return false
    await ChatMessage.findByIdAndDelete(messageId)
    return true
  }
}

export const chatService = new ChatService()
