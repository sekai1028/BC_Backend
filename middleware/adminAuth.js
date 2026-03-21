/**
 * GDD 20: Admin Command Center — protect admin routes with secret.
 * Set ADMIN_SECRET in env; client sends header X-Admin-Secret or Authorization: Bearer <ADMIN_SECRET>.
 */
export function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET || process.env.ADMIN_SECRET_KEY
  if (!secret) {
    return res.status(503).json({ message: 'Admin not configured' })
  }
  const headerSecret = req.headers['x-admin-secret']
  const authHeader = req.headers.authorization
  const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if ((headerSecret && headerSecret === secret) || (bearerSecret && bearerSecret === secret)) {
    return next()
  }
  res.status(401).json({ message: 'Unauthorized' })
}
