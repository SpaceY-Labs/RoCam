import * as admin from "firebase-admin";
import { config, requiredConfig } from "./config";

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: requiredConfig.firebaseProjectId(),
    storageBucket: requiredConfig.firebaseStorageBucket(),
  });
}

export const firestore = admin.firestore();
export const storage = admin.storage();
export const auth = admin.auth();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;

if (config.firebaseProjectId) {
  firestore.settings({
    ignoreUndefinedProperties: true,
  });
}
