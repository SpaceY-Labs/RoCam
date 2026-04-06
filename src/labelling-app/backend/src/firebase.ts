/**
 * Author: Jianqing Liu
 * Date: 2026-01-27
 * Purpose: Initialize Firebase Admin SDK and export Firestore, Auth, and Storage instances.
 */
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { config, requiredConfig } from "./config";

let app = admin.apps.length ? admin.app() : null;

if (!app) {
  app = admin.initializeApp({
    projectId: requiredConfig.firebaseProjectId(),
    storageBucket: requiredConfig.firebaseStorageBucket(),
  });
}

export const firestore = config.firebaseDatabaseId
  ? getFirestore(app, config.firebaseDatabaseId)
  : admin.firestore();
export const storage = admin.storage();
export const auth = admin.auth();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;

if (config.firebaseProjectId) {
  firestore.settings({
    ignoreUndefinedProperties: true,
  });
}
