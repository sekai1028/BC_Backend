/**
 * Crypto deposit via NOWPayments (or placeholder when not configured).
 * Set NOWPAYMENTS_API_KEY and GOLD_USD_PRICE in .env for live payments.
 */

import CryptoDeposit from '../models/CryptoDeposit.js'
import User from '../models/User.js'

const GOLD_USD_PRICE = Number(process.env.GOLD_USD_PRICE) || 0.01
const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1'

function getApiKey() {
  return process.env.NOWPAYMENTS_API_KEY?.trim() || null
}

/** Create a crypto deposit: returns payment details or placeholder. */
export async function createCryptoDeposit(userId, amountGold) {
  if (!Number.isFinite(amountGold) || amountGold <= 0) {
    throw new Error('Amount must be a positive number')
  }
  const userIdStr = userId?.toString?.() || String(userId)
  const amountUsd = Math.max(0.01, amountGold * GOLD_USD_PRICE)
  const orderId = `bunker-${userIdStr}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  const apiKey = getApiKey()
  if (!apiKey) {
    const placeholder = await CryptoDeposit.create({
      userId,
      amountGold,
      amountUsd,
      orderId,
      status: 'pending',
      payCurrency: 'usdt',
      payAddress: null,
      payAmount: null,
      expiresAt
    })
    return {
      orderId: placeholder.orderId,
      amountGold: placeholder.amountGold,
      amountUsd: placeholder.amountUsd,
      payCurrency: 'usdt',
      payAddress: null,
      payAmount: null,
      payAmountFormatted: null,
      expiresAt: placeholder.expiresAt,
      message: 'Crypto deposit is not configured. Set NOWPAYMENTS_API_KEY in server .env to enable.'
    }
  }

  const ipnCallbackUrl = process.env.NOWPAYMENTS_IPN_URL || null
  const body = {
    price_amount: Math.round(amountUsd * 100) / 100,
    price_currency: 'usd',
    order_id: orderId,
    order_description: `Bunker gold: ${amountGold} gold`,
    ...(ipnCallbackUrl && { ipn_callback_url: ipnCallbackUrl })
  }

  const res = await fetch(`${NOWPAYMENTS_API}/payment`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('[crypto] NOWPayments create payment failed', res.status, data)
    throw new Error(data.message || data.err || `Payment provider error: ${res.status}`)
  }

  await CryptoDeposit.create({
    userId,
    amountGold,
    amountUsd,
    orderId: data.order_id || orderId,
    providerPaymentId: data.payment_id || null,
    payCurrency: (data.pay_currency || 'usdt').toLowerCase(),
    payAmount: data.pay_amount ? Number(data.pay_amount) : null,
    payAddress: data.pay_address || null,
    status: 'pending',
    expiresAt
  })

  return {
    orderId: data.order_id || orderId,
    amountGold,
    amountUsd,
    payCurrency: (data.pay_currency || 'usdt').toLowerCase(),
    payAddress: data.pay_address || null,
    payAmount: data.pay_amount ? Number(data.pay_amount) : null,
    payAmountFormatted: data.pay_amount ? String(data.pay_amount) : null,
    expiresAt,
    invoiceUrl: data.invoice_url || null
  }
}

/** Handle NOWPayments IPN: mark deposit completed and credit user. */
export async function handlePaymentCompleted(orderId) {
  const deposit = await CryptoDeposit.findOne({ orderId, status: 'pending' })
  if (!deposit) return false
  deposit.status = 'completed'
  deposit.completedAt = new Date()
  await deposit.save({ validateBeforeSave: false })

  const user = await User.findById(deposit.userId)
  if (user) {
    user.gold = (user.gold ?? 0) + deposit.amountGold
    await user.save({ validateBeforeSave: false })
    console.log('[crypto] Deposit completed', { orderId, userId: user._id.toString(), gold: deposit.amountGold })
  }
  return true
}
