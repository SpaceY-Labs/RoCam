import { db } from '../config/firebase.js';
import { ProjectMember } from 'shared';

export async function getMember(
  projectId: string,
  userId: string
): Promise<ProjectMember | null> {
  const doc = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(userId)
    .get();
  if (!doc.exists) {
    return null;
  }
  return { ...(doc.data() as ProjectMember) };
}

export async function updateMember(
  projectId: string,
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .doc(userId)
    .update(data);
}




