import { db } from '../config/firebase.js';
import { CollectionReference } from 'firebase-admin/firestore';

export function getMasksCollection(
  projectId: string,
  imageId: string
): CollectionReference {
  return db
    .collection('projects')
    .doc(projectId)
    .collection('images')
    .doc(imageId)
    .collection('masks');
}




