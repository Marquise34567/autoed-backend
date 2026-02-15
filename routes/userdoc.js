const express = require('express')
const router = express.Router()
const admin = require('../utils/firebaseAdmin')

// GET /api/userdoc
// If Authorization: Bearer <idToken> is provided, verify and return user doc.
// Otherwise return safe defaults. Never throw.
router.get('/', async (req, res) => {
  try {
    const auth = req.headers.authorization || req.headers.Authorization || null
    const token = auth && auth.startsWith('Bearer ') ? auth.split(' ')[1] : null
    if (!token) {
      return res.status(200).json({ ok: true, uid: null, plan: 'starter', rendersLeft: 12 })
    }

    if (!admin || admin._missingEnv) return res.status(200).json({ ok: true, uid: null, plan: 'starter', rendersLeft: 12 })

    try {
      const decoded = await admin.auth().verifyIdToken(token)
      const uid = decoded && decoded.uid ? decoded.uid : null
      if (!uid) return res.status(200).json({ ok: true, uid: null, plan: 'starter', rendersLeft: 12 })

      const db = admin.firestore()
      const snap = await db.collection('users').doc(uid).get()
      if (!snap.exists) return res.status(200).json({ ok: true, uid, plan: 'starter', rendersLeft: 12 })
      const doc = snap.data() || {}
      const plan = doc.plan || 'starter'
      const rendersLeft = typeof doc.rendersLeft === 'number' ? doc.rendersLeft : (plan === 'pro' ? 9999 : 12)
      return res.status(200).json({ ok: true, uid, plan, rendersLeft })
    } catch (e) {
      console.error('[api/userdoc] token verify or db error', e && (e.stack || e.message || e))
      return res.status(200).json({ ok: true, uid: null, plan: 'starter', rendersLeft: 12 })
    }
  } catch (e) {
    console.error('[api/userdoc] unexpected error', e && (e.stack || e.message || e))
    return res.status(200).json({ ok: true, uid: null, plan: 'starter', rendersLeft: 12 })
  }
})

module.exports = router
