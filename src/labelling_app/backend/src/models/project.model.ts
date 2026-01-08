import { db } from '../config/firebase.js';
import { Project } from 'shared';

export async function getProject(projectId: string): Promise<Project | null> {
  const doc = await db.collection('projects').doc(projectId).get();
  if (!doc.exists) {
    return null;
  }
  return { ...(doc.data() as Project), id: doc.id };
}






