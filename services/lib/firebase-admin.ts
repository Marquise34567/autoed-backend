import adminDefault, * as adminAll from 'firebase-admin'
import firebaseAdmin from './firebase/admin'

// Re-export the default firebase admin instance and helpers for imports using `firebase-admin` name
export { getBucket, getBucketName } from './firebaseAdmin'
export const admin = adminDefault
export default adminDefault
export const isAdminInitialized = () => !!adminAll.apps && adminAll.apps.length > 0
