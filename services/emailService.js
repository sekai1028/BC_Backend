import nodemailer from 'nodemailer'

let transporter = null

function getSender() {
  const from = process.env.EMAIL_FROM || (process.env.EMAIL_USER ? `Bunker <${process.env.EMAIL_USER}>` : 'Bunker <noreply@bunker.game>')
  const match = from.match(/^(.+?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim() }
  return { name: 'Bunker', email: from.trim() }
}

/** Sender for login/uplink emails: "The AI Oracle" (same address as default). */
function getLoginCodeSender() {
  const base = getSender()
  return { name: 'The AI Oracle', email: base.email }
}

function getTransporter() {
  if (transporter) return transporter
  const host = process.env.EMAIL_HOST
  const port = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587
  const user = process.env.EMAIL_USER
  const pass = process.env.EMAIL_PASS
  if (!host || !user || !pass) {
    console.log('[email] SMTP not configured: missing EMAIL_HOST, EMAIL_USER, or EMAIL_PASS')
    return null
  }
  const secure = port === 465
  console.log('[email] SMTP transport', { host, port, secure, user: user.replace(/@.*/, '@***') })
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    debug: process.env.EMAIL_DEBUG === '1',
  })
  return transporter
}

/** Send via Brevo HTTP API (HTTPS, no SMTP port). API key must be from Brevo → Settings → API Keys (starts with xkeysib-). */
async function sendViaBrevoApi(toEmail, subject, textContent, htmlContent) {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  if (!apiKey) return null
  const sender = getSender()
  if (!sender.email) {
    throw new Error('EMAIL_FROM or EMAIL_USER required for Brevo API sender')
  }
  console.log('[email] Using Brevo API (HTTPS)', { to: toEmail.replace(/(.{2}).*@(.*)/, '$1***@$2') })
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: sender.name, email: sender.email },
      to: [{ email: toEmail }],
      subject,
      textContent,
      htmlContent,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data.message || data.code || `Brevo API ${res.status}`
    console.error('[email] Brevo API error', { status: res.status, message: msg })
    if (res.status === 401) {
      throw new Error('Invalid Brevo API key. Get the key from Brevo → Settings → API Keys (starts with xkeysib-).')
    }
    throw new Error(msg)
  }
  console.log('[email] Sent via Brevo API', { messageId: data.messageId })
  return { messageId: data.messageId }
}

/** Send a simple notification to ADMIN_EMAIL (if set). Used for chat reports, etc. */
export async function sendAdminNotification(subject, textContent) {
  const to = process.env.ADMIN_EMAIL?.trim()
  if (!to) return
  const html = `<p>${String(textContent).replace(/\n/g, '</p><p>')}</p>`
  if (process.env.BREVO_API_KEY?.trim()) {
    const sender = getSender()
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: sender.name, email: sender.email },
        to: [{ email: to }],
        subject: `[Bunker] ${subject}`,
        textContent,
        htmlContent: html,
      }),
    })
    return
  }
  const transport = getTransporter()
  if (transport) {
    await transport.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@bunker.game',
      to,
      subject: `[Bunker] ${subject}`,
      text: textContent,
      html,
    })
  }
}

const SUPPORT_INBOX = 'info@holdorfold.io'

/**
 * Send support form submission to info@holdorfold.io (SMTP or Brevo).
 * @param {{ email: string, errorType: string, message: string }} payload - email, error_type, message
 */
export async function sendSupportNotification(payload) {
  const { email = '', errorType = '', message = '' } = payload || {}
  const subject = `[Hold or Fold Support] ${(errorType || 'Support').slice(0, 50)}`
  const textContent = [
    '——— Support request ———',
    '',
    'Email:      ' + email,
    'Error type: ' + (errorType || '—'),
    '',
    'Message:',
    '─────────',
    message || '(no message)',
    '─────────',
  ].join('\n')
  const messageHtml = escapeHtml(message || '(no message)').replace(/\n/g, '<br>')
  const htmlContent = [
    '<div style="font-family:sans-serif;max-width:560px;color:#333;">',
    '  <h2 style="color:#0a0;font-size:1.1em;margin-bottom:1em;">Support request</h2>',
    '  <table style="border-collapse:collapse;width:100%;margin-bottom:1.25em;">',
    '    <tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-weight:600;color:#555;white-space:nowrap;">Email</td><td style="padding:6px 0;">' + escapeHtml(email) + '</td></tr>',
    '    <tr><td style="padding:6px 12px 6px 0;vertical-align:top;font-weight:600;color:#555;white-space:nowrap;">Error type</td><td style="padding:6px 0;">' + escapeHtml(errorType || '—') + '</td></tr>',
    '  </table>',
    '  <p style="font-weight:600;color:#555;margin-bottom:6px;">Message</p>',
    '  <div style="background:#f5f5f5;border-left:4px solid #0a0;padding:12px 14px;border-radius:0 6px 6px 0;">' + messageHtml + '</div>',
    '</div>',
  ].join('')

  if (process.env.BREVO_API_KEY?.trim()) {
    const sender = getSender()
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: sender.name, email: sender.email },
        to: [{ email: SUPPORT_INBOX }],
        subject,
        textContent,
        htmlContent,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.message || `Brevo ${res.status}`)
    }
    console.log('[email] Support notification sent via Brevo to', SUPPORT_INBOX)
    return
  }

  const transport = getTransporter()
  if (!transport) {
    throw new Error('Email not configured: set BREVO_API_KEY or EMAIL_HOST/EMAIL_USER/EMAIL_PASS for SMTP')
  }
  await transport.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@bunker.game',
    to: SUPPORT_INBOX,
    subject,
    text: textContent,
    html: htmlContent,
  })
  console.log('[email] Support notification sent via SMTP to', SUPPORT_INBOX)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}


/** Send verification email. Uses Brevo API if BREVO_API_KEY is set, else SMTP. */
export async function sendVerificationEmail(toEmail, options = {}) {
  const { verifyLink, code } = options
  const primaryCta = verifyLink
    ? `
      <p><strong>Click the link below to verify your email (no code needed):</strong></p>
      <p style="margin:20px 0;"><a href="${verifyLink}" style="display:inline-block;padding:12px 24px;background:#00FF41;color:#000;text-decoration:none;font-weight:bold;border-radius:8px;">Verify my email</a></p>
      <p style="font-size:12px;color:#888;">Or copy this link: ${verifyLink}</p>
    `
    : ''
  const codeSection = code
    ? `<p>If the link doesn't work, use this code on the site: <strong style="letter-spacing:4px;color:#00FF41;">${code}</strong></p>`
    : ''
  const textParts = [
    'Verify your Bunker account.',
    verifyLink && `Click: ${verifyLink}`,
    code && `Or use code: ${code}`,
    'Link and code expire in 15 minutes.',
    "If you didn't create an account, ignore this email."
  ].filter(Boolean)
  const subject = 'Verify your Bunker account'
  const textContent = textParts.join('\n\n')
  const htmlContent = `
    <p>Welcome to Bunker.</p>
    ${primaryCta}
    ${codeSection}
    <p style="margin-top:20px;font-size:12px;color:#888;">Expires in 15 minutes.</p>
    <p style="font-size:12px;color:#888;">If you didn't create an account, you can ignore this email.</p>
  `

  // Use Brevo API when key is set (HTTPS, works when SMTP ports are blocked)
  if (process.env.BREVO_API_KEY?.trim()) {
    try {
      await sendViaBrevoApi(toEmail, subject, textContent, htmlContent)
      return { sent: true }
    } catch (err) {
      console.error('[email] Send failed (Brevo API)', err.message)
      throw err
    }
  }

  // Fallback: SMTP (often blocked on port 587/465)
  const transport = getTransporter()
  if (!transport) {
    console.warn('[email] Not configured: set BREVO_API_KEY (recommended) or EMAIL_HOST/USER/PASS for SMTP')
    return { sent: false, verifyLink, code }
  }
  console.log('[email] Using SMTP to', toEmail.replace(/(.{2}).*@(.*)/, '$1***@$2'))
  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM || (process.env.EMAIL_USER ? `Bunker <${process.env.EMAIL_USER}>` : 'Bunker <noreply@bunker.game>'),
      to: toEmail,
      subject,
      text: textContent,
      html: htmlContent,
    })
    console.log('[email] Sent via SMTP', { messageId: info.messageId })
    return { sent: true }
  } catch (err) {
    console.error('[email] Send failed (SMTP)', {
      to: toEmail.replace(/(.{2}).*@(.*)/, '$1***@$2'),
      error: err.message,
      code: err.code,
    })
    throw err
  }
}

/** Send passwordless login code (uplink email). From: The AI Oracle. Optional magicLink for one-click login. */
export async function sendLoginCodeEmail(toEmail, code, magicLink = '') {
  const subject = `UPLINK: ${code} (Bunker Access Code) - [Hold or Fold]`
  const strategyUrl = process.env.STRATEGY_GUIDE_URL || 'https://TimingTheTop.com'
  const textContent = [
    'Exile,',
    '',
    'The AI Oracle has processed your request for a terminal uplink. Use the following key to bypass the Syndicate firewall:',
    '',
    `[ ${code} ]`,
    '',
    magicLink ? `Instant Access: ${magicLink}` : 'Enter the code on the site to access your account.',
    '',
    'Note: This key will self-destruct (expire) in 15 minutes.',
    '',
    'Wrong terminal? Ignore this transmission.',
    '',
    'Hold or Fold: The Game',
    `${strategyUrl}: Official Strategy Guide & Wiki`
  ].join('\n')

  const htmlContent = `
    <p>Exile,</p>
    <p>The AI Oracle has processed your request for a terminal uplink. Use the following key to bypass the Syndicate firewall:</p>
    <p style="margin:16px 0;font-size:22px;letter-spacing:6px;font-weight:bold;color:#00FF41;">[ ${code} ]</p>
    ${magicLink ? `<p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#00FF41;color:#000;text-decoration:none;font-weight:bold;border-radius:8px;">Click Here to Auto-Login</a></p>` : ''}
    <p style="font-size:12px;color:#888;">Note: This key will self-destruct (expire) in 15 minutes.</p>
    <p style="font-size:12px;color:#888;">Wrong terminal? Ignore this transmission.</p>
    <p style="margin-top:24px;font-size:12px;color:#888;">Hold or Fold: The Game<br><a href="${strategyUrl}" style="color:#00FF41;">${strategyUrl}: Official Strategy Guide & Wiki</a></p>
  `

  const sender = getLoginCodeSender()

  if (process.env.BREVO_API_KEY?.trim()) {
    try {
      const apiKey = process.env.BREVO_API_KEY.trim()
      console.log('[email] Using Brevo API (login code)', { to: toEmail.replace(/(.{2}).*@(.*)/, '$1***@$2') })
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          sender: { name: sender.name, email: sender.email },
          to: [{ email: toEmail }],
          subject,
          textContent,
          htmlContent,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data.message || data.code || `Brevo API ${res.status}`
        console.error('[email] Brevo API error', { status: res.status, message: msg })
        throw new Error(msg)
      }
      console.log('[email] Sent via Brevo API', { messageId: data.messageId })
      return { sent: true }
    } catch (err) {
      console.error('[email] Send login code failed (Brevo API)', err.message)
      throw err
    }
  }

  const transport = getTransporter()
  if (!transport) {
    console.warn('[email] Not configured: set BREVO_API_KEY or SMTP for login codes')
    return { sent: false }
  }
  try {
    const fromStr = `${sender.name} <${sender.email}>`
    await transport.sendMail({
      from: fromStr,
      to: toEmail,
      subject,
      text: textContent,
      html: htmlContent,
    })
    return { sent: true }
  } catch (err) {
    console.error('[email] Send login code failed (SMTP)', err.message)
    throw err
  }
}
