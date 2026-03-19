import express from 'express'
import Stripe from 'stripe'
import { handlePaymentCompleted } from '../services/cryptoDepositService.js'
import { fulfillPurchase } from './shop.js'

const router = express.Router()

/** Lazy Stripe + webhook secret so env is read after dotenv has run (same load-order fix as shop). */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  return key ? new Stripe(key) : null
}
function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || ''
}

/** NOWPayments IPN callback: payment status update. */
router.post('/nowpayments', express.json(), async (req, res) => {
  try {
    const { order_id, payment_status } = req.body || {}
    if (!order_id) {
      return res.status(400).send('Missing order_id')
    }
    if (payment_status === 'finished' || payment_status === 'sent') {
      await handlePaymentCompleted(order_id)
    }
    res.status(200).send('OK')
  } catch (err) {
    console.error('[webhook] nowpayments error', err.message)
    res.status(500).send('Error')
  }
})

/**
 * GDD 5.0: Stripe webhook — use raw body and verify signature.
 * Mount this route with express.raw({ type: 'application/json' }) in server.js.
 */
export async function handleStripeWebhook(req, res) {
  const stripe = getStripe()
  const webhookSecret = getWebhookSecret()
  if (!stripe || !webhookSecret) {
    return res.status(503).send('Stripe not configured')
  }
  const sig = req.headers['stripe-signature']
  if (!sig) {
    return res.status(400).send('Missing stripe-signature')
  }
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    console.error('[webhook] Stripe signature verification failed', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }
  // GDD 5.3: Items only granted on payment_intent.succeeded; metadata UID and SKU_ID
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object
    const userId = paymentIntent.metadata?.UID
    const productId = paymentIntent.metadata?.SKU_ID
    if (userId && productId) {
      try {
        await fulfillPurchase(userId, productId)
        console.log('[webhook] Stripe purchase fulfilled', { userId, productId })
      } catch (err) {
        console.error('[webhook] Stripe fulfillment error', err.message)
        return res.status(500).send('Fulfillment failed')
      }
    }
  }
  res.status(200).send('OK')
}

export default router
