
import {ref, uploadBytes, getDownloadURL} from "firebase/storage";
import {storage, auth} from "../firebaseconfig";
import { signInAnonymously } from "firebase/auth";
/**
 * Uploads an image to Firebase Storage
 * @param {File} file - The file object from the input
 * @returns {Promise<string>} - The download URL of the uploaded image
 */
export const uploadImageToFirebase = async (file : any) => {
  if (!file) return null;

  try {

    if (!auth.currentUser) {
        await signInAnonymously(auth);
    }
    // Create a unique filename using a timestamp
    const storageRef = ref(storage, `Images_Raw/${Date.now()}_${file.name}`);
    // Upload the file
    const snapshot = await uploadBytes(storageRef, file);
    // Get and return the public download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
  } catch (error) {
    console.error("Upload failed:", error);
    throw error;
  }
};


