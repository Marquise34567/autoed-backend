const admin = require("firebase-admin");

function getServiceAccount() {
  const json =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!json) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  const svc = typeof json === 'string' ? JSON.parse(json) : json;
  if (svc.private_key) svc.private_key = svc.private_key.replace(/\\n/g, "\n");
  return svc;
}

const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET || "autoeditor-d4940.appspot.com";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount()),
    storageBucket,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket(storageBucket);

module.exports = { admin, db, bucket };
