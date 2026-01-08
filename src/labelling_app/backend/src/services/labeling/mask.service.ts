import { db } from '../../config/firebase.js';
import { Mask, SaveMasksInput } from 'shared';
import { getMasksCollection } from '../../models/mask.model.js';
import { generateCombinedMask } from './combinedMask.service.js';
import { FieldValue } from 'firebase-admin/firestore';
import type { Transaction } from 'firebase-admin/firestore';

export async function getMasks(
  projectId: string,
  imageId: string
): Promise<Mask[]> {
  const snapshot = await getMasksCollection(projectId, imageId).get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Mask[];
}

export async function saveMasks(
  projectId: string,
  imageId: string,
  input: SaveMasksInput,
  userId: string
): Promise<Mask[]> {
  const masksCollection = getMasksCollection(projectId, imageId);

  const savedMasks = await db.runTransaction(async (transaction: Transaction) => {
    const existingSnapshot = await transaction.get(masksCollection);

    existingSnapshot.docs.forEach((doc) => {
      transaction.delete(doc.ref);
    });

    const now = FieldValue.serverTimestamp() as unknown as Mask['createdAt'];
    const newMasks: Mask[] = [];

    for (const maskInput of input.masks) {
      const docRef = masksCollection.doc();
      const mask: Omit<Mask, 'id'> = {
        ...maskInput,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };

      transaction.set(docRef, mask);
      newMasks.push({ id: docRef.id, ...mask } as Mask);
    }

    return newMasks;
  });

  generateCombinedMask(projectId, imageId).catch((err: unknown) => {
    console.error('Failed to generate combined mask:', err);
  });

  return savedMasks;
}

export async function deleteMasks(
  projectId: string,
  imageId: string
): Promise<void> {
  const snapshot = await getMasksCollection(projectId, imageId).get();

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
}







