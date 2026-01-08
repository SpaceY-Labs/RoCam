import { db } from '../../config/firebase.js';
import { AssignRequest, AssignResponse } from 'shared';
import { getImagesCollection } from '../../models/image.model.js';
import { updateMember } from '../../models/member.model.js';
import { refreshLocks } from './lock.service.js';
import { FieldValue } from 'firebase-admin/firestore';

export async function assign(
  projectId: string,
  request: AssignRequest,
  requesterId: string
): Promise<AssignResponse> {
  void requesterId;

  const result: AssignResponse = {
    success: true,
    assigned: {},
    summary: { totalMoved: 0, poolRemaining: 0 },
  };

  switch (request.strategy) {
    case 'count':
      await assignByCount(projectId, request, result);
      break;
    case 'images':
      await assignByImageIds(projectId, request, result);
      break;
    case 'unassign':
      await unassignImages(projectId, request, result);
      break;
    case 'rebalance':
      await rebalanceImages(projectId, request, result);
      break;
  }

  const affectedUsers = Object.keys(result.assigned);
  await Promise.all(affectedUsers.map((userId) => refreshLocks(projectId, userId)));

  const poolQuery = await getImagesCollection(projectId)
    .where('status', '==', 'unlabeled')
    .where('assignedTo', '==', null)
    .count()
    .get();
  result.summary.poolRemaining = poolQuery.data().count;

  return result;
}

async function assignByCount(
  projectId: string,
  request: AssignRequest,
  result: AssignResponse
): Promise<void> {
  const { assignTo, count, priority = 'oldest' } = request;

  let query = getImagesCollection(projectId)
    .where('assignedTo', '==', null)
    .where('status', '==', 'unlabeled');

  if (priority === 'oldest') {
    query = query.orderBy('uploadedAt', 'asc');
  } else if (priority === 'newest') {
    query = query.orderBy('uploadedAt', 'desc');
  }

  query = query.limit(count!);

  const snapshot = await query.get();
  let images = snapshot.docs;

  if (priority === 'random') {
    images = images.sort(() => Math.random() - 0.5);
  }

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const doc of images) {
    batch.update(doc.ref, {
      assignedTo: assignTo,
      assignedAt: now,
      status: 'assigned',
    });
  }

  await batch.commit();

  await updateMember(projectId, assignTo!, {
    'stats.assigned': FieldValue.increment(images.length) as any,
  });

  result.assigned[assignTo!] = images.length;
  result.summary.totalMoved = images.length;
}

async function assignByImageIds(
  projectId: string,
  request: AssignRequest,
  result: AssignResponse
): Promise<void> {
  const { assignTo, imageIds } = request;

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  const imagesCollection = getImagesCollection(projectId);

  for (const imageId of imageIds!) {
    const docRef = imagesCollection.doc(imageId);
    batch.update(docRef, {
      assignedTo: assignTo,
      assignedAt: now,
      status: 'assigned',
    });
  }

  await batch.commit();

  result.assigned[assignTo!] = imageIds!.length;
  result.summary.totalMoved = imageIds!.length;
}

async function unassignImages(
  projectId: string,
  request: AssignRequest,
  result: AssignResponse
): Promise<void> {
  const { unassignFrom, unassignFilter = 'all' } = request;

  let query = getImagesCollection(projectId).where('assignedTo', '==', unassignFrom);

  if (unassignFilter === 'unlabeled') {
    query = query.where('status', 'in', ['assigned', 'in_progress']);
  } else if (unassignFilter === 'assigned') {
    query = query.where('status', '==', 'assigned');
  }

  const snapshot = await query.get();

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.update(doc.ref, {
      assignedTo: null,
      assignedAt: null,
      status: 'unlabeled',
      lockState: null,
    });
  }

  await batch.commit();

  result.assigned[unassignFrom!] = -snapshot.docs.length;
  result.summary.totalMoved = snapshot.docs.length;
}

async function rebalanceImages(
  projectId: string,
  request: AssignRequest,
  result: AssignResponse
): Promise<void> {
  void projectId;
  void request;
  void result;
}







