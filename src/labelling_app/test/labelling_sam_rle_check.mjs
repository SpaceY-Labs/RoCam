import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInAnonymously,
} from "firebase/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "..", ".env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function getFirebaseIdToken() {
  const missing = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
  ].filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing Firebase config: ${missing.join(", ")}`);
  }

  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID,
  });

  const auth = getAuth(app);
  try {
    await setPersistence(auth, inMemoryPersistence);
  } catch (error) {
    void error;
  }

  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulatorHost) {
    const emulatorUrl = emulatorHost.startsWith("http")
      ? emulatorHost
      : `http://${emulatorHost}`;
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
  }

  const credential = await signInAnonymously(auth);
  return credential.user.getIdToken();
}

const toApiBase = (rawBase) => {
  const trimmed = rawBase.replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBox = (raw) => {
  if (!raw) {
    return null;
  }
  const parts = String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  if (parts.length !== 4) {
    return null;
  }
  return { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] };
};

loadEnvFile(envPath);

const API_BASE_URL = process.env.API_BASE_URL || process.env.BACKEND_SERVICE_URL;
if (!API_BASE_URL) {
  console.error("Missing API_BASE_URL (e.g. https://example.run.app)");
  process.exit(1);
}

const apiBase = toApiBase(API_BASE_URL);

let authToken = process.env.AUTH_TOKEN;
if (!authToken) {
  try {
    authToken = await getFirebaseIdToken();
  } catch (error) {
    console.error(
      `Missing AUTH_TOKEN and failed to fetch from Firebase Auth (${error.message}).`
    );
    process.exit(1);
  }
}

const imageUrl = process.env.SAM_RLE_IMAGE_URL;
const projectId = process.env.SAM_RLE_PROJECT_ID || process.env.PROJECT_ID;
const imageId = process.env.SAM_RLE_IMAGE_ID || process.env.IMAGE_ID;

if (!imageUrl && (!projectId || !imageId)) {
  console.error(
    "Missing SAM_RLE_IMAGE_URL or SAM_RLE_PROJECT_ID + SAM_RLE_IMAGE_ID."
  );
  process.exit(1);
}

const mode = (process.env.SAM_RLE_MODE || "click").toLowerCase();
const prompt = process.env.SAM_RLE_PROMPT;

const payload = {
  mode,
};

if (imageUrl) {
  payload.imageUrl = imageUrl;
} else {
  payload.projectId = projectId;
  payload.imageId = imageId;
}

if (mode === "auto" && prompt) {
  payload.prompt = prompt;
}

const box = parseBox(process.env.SAM_RLE_BOX);
if (box) {
  payload.box = box;
}

if (mode !== "auto") {
  const x = parseNumber(process.env.SAM_RLE_POINT_X, 0.5);
  const y = parseNumber(process.env.SAM_RLE_POINT_Y, 0.5);
  payload.points = [{ x, y, label: 1 }];
}

const response = await fetch(`${apiBase}/segment`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
let body = null;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  body = text;
}

if (!response.ok) {
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  console.error(`FAIL sam rle (${response.status}) ${detail}`);
  process.exit(1);
}

const masks = body?.masks;
if (!Array.isArray(masks) || masks.length === 0) {
  console.error("FAIL sam rle: response.masks is empty");
  process.exit(1);
}

const first = masks[0] || {};
const rle = first.rle;
if (!rle || typeof rle.counts !== "string") {
  console.error("FAIL sam rle: missing rle.counts");
  process.exit(1);
}

if (!Array.isArray(rle.size) || rle.size.length !== 2) {
  console.error("FAIL sam rle: missing rle.size");
  process.exit(1);
}

const [height, width] = rle.size;
if (!Number.isInteger(height) || !Number.isInteger(width)) {
  console.error("FAIL sam rle: rle.size must be integers");
  process.exit(1);
}

const bbox = first.boundingBox;
if (
  !bbox ||
  !["x", "y", "w", "h"].every((key) => Number.isFinite(Number(bbox[key])))
) {
  console.error("FAIL sam rle: missing boundingBox");
  process.exit(1);
}

console.log(
  `PASS sam rle: masks=${masks.length} size=${height}x${width}`
);
