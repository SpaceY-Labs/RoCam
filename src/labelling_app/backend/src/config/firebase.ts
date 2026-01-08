import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const auth: Auth = admin.auth();
export const db: Firestore = admin.firestore();
export const storage: Storage = admin.storage();
