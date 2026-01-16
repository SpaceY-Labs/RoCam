import { firestore } from "../firebase";
import { HttpError } from "../middleware/error";

const projectsCollection = firestore.collection("projects");

export const ensureProjectAccess = async (projectId: string, uid: string) => {
  const doc = await projectsCollection.doc(projectId).get();
  if (!doc.exists) {
    throw new HttpError(404, "NOT_FOUND", "Project not found");
  }
  return doc;
};

export const getProjectImagesCollection = (projectId: string) =>
  projectsCollection.doc(projectId).collection("images");

export const getProjectLocksCollection = (projectId: string) =>
  projectsCollection.doc(projectId).collection("locks");

export const getProjectDoc = (projectId: string) =>
  projectsCollection.doc(projectId);
