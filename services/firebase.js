"use strict";
/**
 * @deprecated
 * This project separates Firebase helpers:
 * - Browser SDK: `@/lib/firebase.client`
 * - Admin SDK: `@/lib/firebaseAdmin`
 *
 * Keep this file as a tiny, valid module so builds don't fail if it exists in
 * the TypeScript include set, and so accidental imports get a clear message.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPRECATED_FIREBASE_IMPORT_MESSAGE = void 0;
exports.DEPRECATED_FIREBASE_IMPORT_MESSAGE = "Importing '@/lib/firebase' is deprecated. Use '@/lib/firebase.client' or '@/lib/firebaseAdmin'.";
exports.default = { message: exports.DEPRECATED_FIREBASE_IMPORT_MESSAGE };
