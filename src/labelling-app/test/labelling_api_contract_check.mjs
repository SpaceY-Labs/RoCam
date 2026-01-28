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
let userId = process.env.USER_ID;

if (!authToken) {
  try {
    authToken = await getFirebaseIdToken();
    // Get the userId from the auth token
    const auth = getAuth();
    userId = auth.currentUser?.uid || userId;
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

const runZipUploadTest = async (projectId) => {
  // Create a minimal valid ZIP file with a single PNG image
  // This is a minimal ZIP containing a 1x1 PNG in /image/ folder
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();

  // Minimal 1x1 transparent PNG
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/WSH2ZcAAAAASUVORK5CYII=";
  const pngBuffer = Buffer.from(pngBase64, "base64");

  zip.addFile("image/sample.png", pngBuffer);
  const zipBuffer = zip.toBuffer();

  const form = new FormData();
  const blob = new Blob([zipBuffer], { type: "application/zip" });
  form.append("zipData", blob, "test.zip");
  form.append(
    "meta",
    JSON.stringify({
      status: "unlabeled",
      tags: ["test"],
    })
  );

  const response = await fetch(`${apiBase}/projects/${projectId}/images/zip`, {
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

  return { name: "zip upload", ok: response.ok, status: response.status, body: json };
};

const runLockTest = async (projectId, imageId, testUserId) => {
  return runJsonTest("lock acquire", "POST", `/projects/${projectId}/locks`, {
    imageIds: [imageId],
    userId: testUserId,
    durationMs: 15000, // 15 seconds as per design doc
  });
};

const runLockReleaseTest = async (projectId, imageId, testUserId) => {
  return runJsonTest("lock release", "DELETE", `/projects/${projectId}/locks`, {
    imageIds: [imageId],
    userId: testUserId,
  });
};

const results = [];

// Test 1: Health check
results.push(await runHealthTest());

// Test 2: Create project with new labels format
const createProject = await runJsonTest("project create", "POST", "/projects", {
  name: "API Contract Test Project",
  description: "Automated contract test",
  labels: {
    lbl_001: { labelId: "lbl_001", name: "Object", color: "#00FF00" },
    lbl_002: { labelId: "lbl_002", name: "Background", color: "#FF0000" },
  },
});
results.push(createProject);

const projectId = createProject.body?.projectId || process.env.PROJECT_ID;

if (projectId) {
  // Test 3: List projects
  const projectsList = await runJsonTest("projects list", "GET", "/projects");
  results.push(projectsList);

  // Verify labels are returned in list
  if (projectsList.ok) {
    const projectInList = projectsList.body?.items?.find(p => p.projectId === projectId);
    if (projectInList && projectInList.labels) {
      console.log("  ✓ Labels returned in project list");
    }
  }

  // Test 4: Get single project
  const projectGet = await runJsonTest("project get", "GET", `/projects/${projectId}`);
  results.push(projectGet);

  // Verify labels structure
  if (projectGet.ok && projectGet.body?.labels) {
    const labels = projectGet.body.labels;
    if (labels.lbl_001 && labels.lbl_001.name === "Object") {
      console.log("  ✓ Labels map structure verified");
    }
  }

  // Test 5: ZIP upload
  const upload = await runZipUploadTest(projectId);
  results.push(upload);

  const imageId = upload.body?.imageIds?.[0] || process.env.IMAGE_ID;

  if (imageId) {
    // Test 6: Get image
    const imageGet = await runJsonTest(
      "image get",
      "GET",
      `/projects/${projectId}/images/${imageId}`
    );
    results.push(imageGet);

    // Verify new image fields
    if (imageGet.ok) {
      const img = imageGet.body;
      if (img.maskMapId !== undefined && img.labelComplete !== undefined && img.reviewed !== undefined) {
        console.log("  ✓ Image has new schema fields (maskMapId, labelComplete, reviewed)");
      }
    }

    // Test 7: Get available images
    results.push(
      await runJsonTest(
        "images available",
        "GET",
        `/projects/${projectId}/images/available?limit=5&includeFileUrl=1`
      )
    );

    // Test 8: List images
    results.push(
      await runJsonTest(
        "image list",
        "GET",
        `/projects/${projectId}/images?limit=5`
      )
    );

    // Test 9: Get masks for image
    const masksGet = await runJsonTest(
      "get masks",
      "GET",
      `/projects/${projectId}/images/${imageId}/masks`
    );
    results.push(masksGet);

    // Test 10: Update image
    const imageUpdate = await runJsonTest(
      "image update",
      "PATCH",
      `/projects/${projectId}/images/${imageId}`,
      {
        labelComplete: false,
        reviewed: false,
        meta: { status: "in_progress" },
      }
    );
    results.push(imageUpdate);

    // Test 11 & 12: Lock acquire and release (if we have a userId)
    if (userId) {
      const lockResult = await runLockTest(projectId, imageId, userId);
      results.push(lockResult);

      if (lockResult.ok) {
        const releaseResult = await runLockReleaseTest(projectId, imageId, userId);
        results.push(releaseResult);
      }
    } else {
      console.log("  ⚠ Skipping lock tests (no USER_ID)");
    }
  }

  // Test 13: Update project
  const projectUpdate = await runJsonTest(
    "project update",
    "PATCH",
    `/projects/${projectId}`,
    {
      name: "Updated Test Project",
      labels: {
        lbl_001: { labelId: "lbl_001", name: "Object Updated", color: "#00FF00" },
        lbl_002: { labelId: "lbl_002", name: "Background", color: "#FF0000" },
        lbl_003: { labelId: "lbl_003", name: "New Label", color: "#0000FF" },
      },
    }
  );
  results.push(projectUpdate);

  // Cleanup: Delete project
  if (!process.env.KEEP_TEST_PROJECT) {
    const deleteResult = await runJsonTest(
      "project delete",
      "DELETE",
      `/projects/${projectId}`
    );
    results.push(deleteResult);
  }
}

// Print results
console.log("\n=== Test Results ===\n");
let failures = 0;
for (const result of results) {
  if (!result.ok) {
    failures += 1;
    const detail =
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body);
    console.log(`FAIL ${result.name} (${result.status}) ${detail}`);
  } else {
    console.log(`PASS ${result.name}`);
  }
}

console.log(`\n=== Summary: ${results.length - failures}/${results.length} tests passed ===\n`);

if (failures > 0) {
  process.exit(1);
}
