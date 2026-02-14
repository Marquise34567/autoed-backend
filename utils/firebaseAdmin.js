
const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

if (!serviceAccountJson) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON environment variable is required');
}
if (!storageBucket) {
  throw new Error('FIREBASE_STORAGE_BUCKET environment variable is required');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n');
  }
} catch (e) {
  throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: ' + (e && e.message ? e.message : e));
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: storageBucket
  });
  console.log('Using bucket:', storageBucket);
}

const bucket = admin.storage().bucket(storageBucket);

module.exports = admin;
module.exports.bucket = bucket;
