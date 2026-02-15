#!/usr/bin/env node
// Migration script: normalize documents in `jobs` collection to standard schema
// Usage: node scripts/migrate-jobs-to-standard-schema.js [--dry-run] [--batch-size=N]

const admin = require('../utils/firebaseAdmin')
const os = require('os')

const dryRun = process.argv.includes('--dry-run')
const batchSizeArg = process.argv.find(a => a.startsWith('--batch-size='))
const BATCH_SIZE = batchSizeArg ? Number(batchSizeArg.split('=')[1]) : (parseInt(process.env.MIGRATE_BATCH_SIZE || '200', 10))

function getDb() {
  if (!admin) return null
  // support both shapes from utils/firebaseAdmin exports
  if (admin && typeof admin.firestore === 'function') return admin.firestore()
  if (admin && admin.db) return admin.db
  return null
}

const db = getDb()
if (!db) {
  console.error('Firestore not configured. Set FIREBASE_* env vars before running this script.')
  process.exit(1)
}

console.log('Starting migration: dryRun=', !!dryRun, 'batchSize=', BATCH_SIZE)

function normalizeStatus(raw) {
  if (!raw && raw !== '') return 'queued'
  const s = String(raw).trim()
  const up = s.toUpperCase()
  if (up === 'QUEUED') return 'queued'
  if (up === 'PROCESSING') return 'processing'
  if (up === 'DONE' || up === 'COMPLETED' || up === 'COMPLETE') return 'completed'
  if (up === 'ERROR' || up === 'FAILED') return 'failed'
  // if already lowercase known statuses
  const low = s.toLowerCase()
  if (['queued','processing','completed','failed'].includes(low)) return low
  // fallback
  return low || 'queued'
}

async function migrateBatch(startAfterDoc) {
  let q = db.collection('jobs').orderBy('createdAt').limit(BATCH_SIZE)
  if (startAfterDoc) q = q.startAfter(startAfterDoc)
  const snaps = await q.get()
  if (snaps.empty) return null

  const batch = db.batch()
  let touched = 0
  for (const doc of snaps.docs) {
    const data = doc.data() || {}
    const updates = {}

    // status
    const newStatus = normalizeStatus(data.status || data.state)
    if (String(data.status || '').toLowerCase() !== newStatus) updates.status = newStatus

    // input mapping
    if (data.inputSpec && !data.input) updates.input = data.inputSpec

    // lockedAt / workerId
    if (!('lockedAt' in data)) updates.lockedAt = null
    if (!('workerId' in data)) updates.workerId = null

    // error mapping
    if (!data.error && data.errorMessage) updates.error = data.errorMessage

    // createdAt / updatedAt
    if (!data.createdAt) updates.createdAt = admin.firestore.FieldValue.serverTimestamp()
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp()

    // ensure id field exists
    if (!data.id) updates.id = doc.id

    // Only patch if there are any updates
    if (Object.keys(updates).length > 0) {
      touched++
      if (dryRun) {
        console.log('[dry-run] would update', doc.id, updates)
      } else {
        batch.set(doc.ref, updates, { merge: true })
      }
    }
  }

  if (!dryRun && touched > 0) {
    await batch.commit()
    console.log(`Committed batch: ${snaps.size} docs, ${touched} updated`)
  } else {
    console.log(`Scanned batch: ${snaps.size} docs, ${touched} would be updated`)
  }

  return snaps.docs[snaps.docs.length - 1]
}

async function run() {
  try {
    let cursor = null
    let totalScanned = 0
    let totalTouched = 0
    while (true) {
      const last = await migrateBatch(cursor)
      if (!last) break
      cursor = last
      totalScanned += BATCH_SIZE
      // note: touched count per batch logged already
      // proceed to next batch
    }
    console.log('Migration completed (dryRun=' + !!dryRun + ').')
    process.exit(0)
  } catch (err) {
    console.error('Migration failed:', err && (err.stack || err.message || err))
    process.exit(2)
  }
}

if (require.main === module) run()

module.exports = { migrateBatch, run }
