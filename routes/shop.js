/**
 * GDD 5.0: Black Market (Shop). Access via Hamburger → Shop. Stripe Checkout.
 * 5.1: Consumables = one-time gold; Permanent = metalMod/oracleMod (best-in-slot, additive to base 1.0).
 */

import express from 'express'
import Stripe from 'stripe'
import User from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'
import { getSscBalance } from '../utils/sscBalance.js'

const router = express.Router()
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

/** Lazy Stripe client — env is read at request time so dotenv has already run (avoids load-order issue). */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  return key ? new Stripe(key) : null
}

/** GDD 5.1 product table. effect: { gold?, metalSpeed?, oracleSpeed?, sscBonus?, propagandaFilter?, leaderboardBunkerTag?, leaderboardGlowColor? } */
const PRODUCTS = [
  { id: 'emergency-signal', name: 'Emergency Signal', type: 'consumable', price: 0.99, effect: { gold: 40 } },
  { id: 'small-scrap-bag', name: 'Small Scrap Bag', type: 'consumable', price: 1.99, effect: { gold: 100 } },
  { id: 'medium-cache', name: 'Medium Cache', type: 'consumable', price: 3.99, effect: { gold: 250 } },
  { id: 'large-vault', name: 'Large Vault', type: 'consumable', price: 6.99, effect: { gold: 500 } },
  { id: 'syndicate-hoard', name: 'Syndicate Hoard', type: 'consumable', price: 11.99, effect: { gold: 1000 } },
  { id: 'propaganda-filter', name: 'Propaganda Filter', type: 'permanent', price: 1.99, effect: { propagandaFilter: true } },
  { id: 'oracle-overclock', name: 'Oracle Overclock', type: 'permanent', price: 5.99, effect: { oracleSpeed: 1.0 } },
  {
    id: 'bunker-starter-kit',
    name: 'Bunker Starter Kit',
    type: 'hybrid',
    price: 9.99,
    effect: { gold: 350, oracleSpeed: 1.0, sscBonus: 0.1 }
  },
  {
    id: 'leaderboard-bunker-tags',
    name: 'Leaderboard Bunker Tags',
    type: 'permanent',
    price: 2.99,
    effect: { leaderboardBunkerTag: true, leaderboardGlowColor: '#00FF41' }
  }
]

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null
}

/** Simple coupon codes: code (uppercase) -> { type: 'gold'|'product', gold?: number, productId?: string } */
const COUPONS = {
  FREE10: { type: 'gold', gold: 10 },
  // Add more: EXAMPLE: { type: 'product', productId: 'emergency-signal' }
}

// GET /api/shop/items — catalog for UI
router.get('/items', (req, res) => {
  res.json(PRODUCTS)
})

// POST /api/shop/checkout — create Stripe Checkout session (auth required)
router.post('/checkout', requireAuth, async (req, res) => {
  const { productId } = req.body || {}
  const product = getProduct(productId)
  if (!product) {
    return res.status(400).json({ message: 'Invalid product' })
  }
  const stripe = getStripe()
  if (!stripe) {
    return res.status(503).json({
      message: 'Payments are not configured. The server needs STRIPE_SECRET_KEY in .env to enable Stripe Checkout.',
      code: 'STRIPE_NOT_CONFIGURED'
    })
  }
  const userId = req.user.id
  try {
    // GDD 5.3: Pass UID and SKU_ID in metadata (and on PaymentIntent for payment_intent.succeeded webhook)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(product.price * 100),
          product_data: {
            name: product.name,
            description: (() => {
              const e = product.effect || {}
              if (product.type === 'consumable') return `${e.gold ?? 0} Gold`
              if (product.id === 'propaganda-filter') return 'Doubles SSC from every video ad'
              if (product.id === 'leaderboard-bunker-tags') return 'Glow outline on leaderboard name'
              if (product.type === 'permanent') {
                if (e.metalSpeed) return `+${e.metalSpeed}x Metal Speed`
                if (e.oracleSpeed) return `+${e.oracleSpeed}x Passive Gold`
                return 'Permanent unlock'
              }
              const parts = []
              if (e.gold) parts.push(`${e.gold} Gold`)
              if (e.oracleSpeed) parts.push(`+${e.oracleSpeed}x Passive Gold`)
              if (e.sscBonus) parts.push(`+${e.sscBonus} SSC Residual Data`)
              return parts.join(' · ') || 'Bundle'
            })()
          }
        }
      }],
      success_url: `${FRONTEND_URL}/shop?success=1`,
      cancel_url: `${FRONTEND_URL}/shop?canceled=1`,
      client_reference_id: userId,
      metadata: { UID: userId, SKU_ID: productId },
      payment_intent_data: {
        metadata: { UID: userId, SKU_ID: productId }
      }
    })
    res.json({ url: session.url })
  } catch (err) {
    console.error('[shop] Stripe session error', err.message)
    res.status(500).json({ message: 'Checkout failed' })
  }
})

// POST /api/shop/redeem — redeem coupon code (auth required)
router.post('/redeem', requireAuth, async (req, res) => {
  const { code } = req.body || {}
  const raw = (code ?? '').toString().trim().toUpperCase()
  if (!raw) {
    return res.status(400).json({ message: 'Enter a coupon code' })
  }
  const coupon = COUPONS[raw]
  if (!coupon) {
    return res.status(400).json({ message: 'Invalid or expired code' })
  }
  const user = await User.findById(req.user.id)
  if (!user) return res.status(401).json({ message: 'User not found' })
  const redeemed = Array.isArray(user.redeemedCoupons) ? user.redeemedCoupons : []
  if (redeemed.includes(raw)) {
    return res.status(400).json({ message: 'Code already redeemed' })
  }
  const set = { redeemedCoupons: [...redeemed, raw] }
  if (coupon.type === 'gold' && coupon.gold != null) {
    set.gold = (user.gold ?? 0) + coupon.gold
  }
  if (coupon.type === 'product' && coupon.productId) {
    await fulfillPurchase(req.user.id, coupon.productId)
  }
  await User.findByIdAndUpdate(req.user.id, { $set: set })
  const updated = await User.findById(req.user.id)
  const toClient = (doc) => doc ? {
    id: doc._id.toString(),
    username: doc.username || doc.email?.split('@')[0] || 'Exile',
    gold: doc.gold ?? 0,
    metal: doc.metal ?? 0,
    metalMod: doc.metalMod ?? 0,
    oracleMod: doc.oracleMod ?? 0,
    wagerCap: doc.wagerCap ?? 1,
    vaultLevel: doc.vaultLevel ?? 1,
    rank: doc.rank ?? 0,
    xp: doc.xp ?? doc.totalWagered ?? 0
  } : null
  res.json({ message: 'Coupon applied', user: toClient(updated) })
})

/**
 * Fulfill a purchase: apply consumable gold and/or permanent mods (best-in-slot).
 * GDD 5.1: Permanent boosts do not stack — only the highest owned applies.
 */
export async function fulfillPurchase(userId, productId) {
  const product = getProduct(productId)
  if (!product) return
  const user = await User.findById(userId)
  if (!user) return
  const updates = {}
  if (product.effect.gold != null && product.effect.gold > 0) {
    updates.gold = (user.gold ?? 0) + product.effect.gold
  }
  if (product.effect.metalSpeed != null) {
    const current = user.metalMod ?? 0
    updates.metalMod = Math.max(current, product.effect.metalSpeed)
  }
  if (product.effect.oracleSpeed != null) {
    const current = user.oracleMod ?? 0
    updates.oracleMod = Math.max(current, product.effect.oracleSpeed)
  }
  if (product.effect.sscBonus != null && product.effect.sscBonus > 0) {
    const cur = getSscBalance(user)
    const next = cur + product.effect.sscBonus
    updates.sscBalance = next
    updates.metal = next
  }
  if (product.effect.propagandaFilter) {
    updates.propagandaFilter = true
  }
  if (product.effect.leaderboardBunkerTag) {
    updates.leaderboardBunkerTag = true
    updates.leaderboardGlowColor = product.effect.leaderboardGlowColor || '#00FF41'
  }
  if (Object.keys(updates).length) {
    await User.findByIdAndUpdate(userId, { $set: updates })
  }
}

export { getProduct, PRODUCTS }
export default router
