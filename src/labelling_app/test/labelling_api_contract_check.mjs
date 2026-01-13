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

loadEnvFile(envPath);

const API_BASE_URL = process.env.API_BASE_URL;
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

const headers = {
  Authorization: `Bearer ${authToken}`,
};

const tests = [];

const runJsonTest = async (name, method, path, body) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { name, ok: response.ok, status: response.status, body: json };
};

const runHealthTest = async () => {
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/health`);
  const text = await response.text();
  return { name: "health", ok: response.ok, status: response.status, body: text };
};

const runUploadTest = async (projectId) => {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/WSH2ZcAAAAASUVORK5CYII=";
  const buffer = Buffer.from(pngBase64, "base64");
  const form = new FormData();
  const blob = new Blob([buffer], { type: "image/png" });

  form.append("imageData", blob, "sample.png");
  form.append(
    "meta",
    JSON.stringify({
      fileName: "sample.png",
      width: 1,
      height: 1,
      status: "unlabeled",
      tags: [],
    })
  );

  const response = await fetch(`${apiBase}/projects/${projectId}/images`, {
    method: "POST",
    headers,
    body: form,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { name: "image upload", ok: response.ok, status: response.status, body: json };
};

const runLockTest = async (projectId, imageId) => {
  return runJsonTest("lock acquire", "POST", `/projects/${projectId}/locks`, {
    imageIds: [imageId],
    userId: process.env.USER_ID || "",
    durationMs: 600000,
  });
};

const runSegmentTest = async (projectId, imageId) => {
  return runJsonTest("segment click", "POST", "/segment", {
    projectId,
    imageId,
    mode: "click",
    points: [{ x: 0.5, y: 0.5, label: 1 }],
  });
};

const results = [];

results.push(await runHealthTest());

const createProject = await runJsonTest("project create", "POST", "/projects", {
  name: "Sample Project",
  description: "Contract test",
  classes: [{ id: "cls_001", name: "Object", color: "#00FF00" }],
});
results.push(createProject);

const projectId = createProject.body?.projectId || process.env.PROJECT_ID;

if (projectId) {
  results.push(await runJsonTest("projects list", "GET", "/projects"));
  results.push(await runJsonTest("project get", "GET", `/projects/${projectId}`));

  const upload = await runUploadTest(projectId);
  results.push(upload);

  const imageId = upload.body?.imageId || process.env.IMAGE_ID;
  if (imageId) {
    results.push(
      await runJsonTest(
        "image get",
        "GET",
        `/projects/${projectId}/images/${imageId}`
      )
    );
    results.push(
      await runJsonTest(
        "images available",
        "GET",
        `/projects/${projectId}/images/available?limit=5&includeFileUrl=1`
      )
    );
    results.push(
      await runJsonTest(
        "image list",
        "GET",
        `/projects/${projectId}/images?limit=5`
      )
    );

    if (process.env.USER_ID) {
      results.push(await runLockTest(projectId, imageId));
    }

    if (process.env.RUN_SEGMENT === "1") {
      results.push(await runSegmentTest(projectId, imageId));
    }
  }
}

let failures = 0;
for (const result of results) {
  if (!result.ok) {
    failures += 1;
    console.log(`FAIL ${result.name} (${result.status})`);
  } else {
    console.log(`PASS ${result.name}`);
  }
}

if (failures > 0) {
  process.exit(1);
}
