import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes } from "firebase/storage";

// TODO: Replace the following with your app's Firebase project configuration
// See: https://firebase.google.com/docs/web/learn-more#config-object
// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional

require('dotenv').config();
const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MEASUREMENT_ID,
} = process.env;

export const firebaseConfig = {
  apiKey: VITE_FIREBASE_API_KEY!,
  authDomain: VITE_FIREBASE_AUTH_DOMAIN!,
  projectId: VITE_FIREBASE_PROJECT_ID!,
  storageBucket: VITE_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID!,
  appId: VITE_FIREBASE_APP_ID!,
  measurementId: VITE_FIREBASE_MEASUREMENT_ID!,
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Create a root reference
const storage = getStorage();

const storageRef = ref(storage);
const imagesRef = ref(storage, 'img')
const prototypeRef = ref(storage, 'img/prototype.png');

const File = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xDE, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xE2, 0x26, 0x05, 0x9B, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82]);

uploadBytes(prototypeRef, File ).then((snapshot) => {
    console.log('Uploaded a blob or file!');
    });





