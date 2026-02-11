/**
 * @deprecated
 * This project separates Firebase helpers:
 * - Browser SDK: `@/lib/firebase.client`
 * - Admin SDK: `@/lib/firebaseAdmin`
 *
 * Keep this file as a tiny, valid module so builds don't fail if it exists in
 * the TypeScript include set, and so accidental imports get a clear message.
 */

export const DEPRECATED_FIREBASE_IMPORT_MESSAGE =
  "Importing '@/lib/firebase' is deprecated. Use '@/lib/firebase.client' or '@/lib/firebaseAdmin'.";

export default { message: DEPRECATED_FIREBASE_IMPORT_MESSAGE };
