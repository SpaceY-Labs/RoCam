import { db } from '../config/firebase.js';
import { CollectionReference } from 'firebase-admin/firestore';
import { Image } from 'shared';

export function getImagesCollection(projectId: string): CollectionReference {
  return db.collection('projects').doc(projectId).collection('images');
}

export async function getImage(
  projectId: string,
  imageId: string
): Promise<Image | null> {
  const doc = await getImagesCollection(projectId).doc(imageId).get();
  if (!doc.exists) {
    return null;
  }
  return { ...(doc.data() as Image), id: doc.id };
}

export async function updateImage(
  projectId: string,
  imageId: string,
  data: Record<string, unknown>
): Promise<void> {
  await getImagesCollection(projectId).doc(imageId).update(data);
}





