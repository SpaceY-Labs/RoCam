# Deployment Architecture v2

Note: This document describes the target architecture. For the current
implementation (as-built) module boundaries and API contracts, see
`src/labelling_app/design_doc/as_built.md`.

Aligned with MODULE_DOCUMENTATION_ENHANCED.md

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Dependencies](#2-module-dependencies)
3. [Build Order & Process](#3-build-order--process)
4. [Service Configuration](#4-service-configuration)
5. [Deployment Targets](#5-deployment-targets)
6. [CI/CD Pipeline](#6-cicd-pipeline)
7. [Local Development](#7-local-development)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────┐         ┌─────────────┐         ┌─────────────────────────┐  │
│   │   Browser   │         │  Firebase   │         │      Cloud Run          │  │
│   │             │ ──────► │   Hosting   │         │                         │  │
│   │  React App  │         │    (CDN)    │         │  ┌─────────────────┐    │  │
│   └─────────────┘         └─────────────┘         │  │  Backend API    │    │  │
│         │                                         │  │  (Node/Express) │    │  │
│         │ API calls (Bearer token)                │  └────────┬────────┘    │  │
│         │                                         │           │             │  │
│         ▼                                         │           │ HTTP        │  │
│   ┌─────────────────────────────────────────┐    │           ▼             │  │
│   │              Cloud Run                   │    │  ┌─────────────────┐    │  │
│   │         labeler-backend-xxx.run.app      │◄───┤  │  SAM3 Service   │    │  │
│   └─────────────────────────────────────────┘    │  │  (Python/GPU)   │    │  │
│         │                                         │  └─────────────────┘    │  │
│         │ Firestore SDK                          └─────────────────────────┘  │
│         ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                           Firebase Services                              │  │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │  │
│   │  │  Firestore   │  │   Storage    │  │    Auth      │  │  Functions  │  │  │
│   │  │  (Database)  │  │   (Files)    │  │   (Users)    │  │  (Triggers) │  │  │
│   │  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│         │                                                                      │
│         │ Cloud Tasks (async jobs)                                            │
│         ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                           Cloud Tasks Queues                             │  │
│   │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │  │
│   │  │   export-queue   │  │  thumbnail-queue │  │  combined-mask-queue  │  │  │
│   │  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Dependencies

Based on implementation notes from MODULE_DOCUMENTATION_ENHANCED.md:

### 2.1 Import Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        BUILD-TIME DEPENDENCY GRAPH                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│                           ┌──────────────────┐                                  │
│                           │  shared/         │                                  │
│                           │  ├── types/      │                                  │
│                           │  ├── constants/  │                                  │
│                           │  └── validation/ │                                  │
│                           └────────┬─────────┘                                  │
│                                    │                                            │
│              ┌─────────────────────┼─────────────────────┐                      │
│              │                     │                     │                      │
│              ▼                     ▼                     ▼                      │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐             │
│   │  frontend/       │  │  backend/src/    │  │  backend/        │             │
│   │                  │  │                  │  │  functions/      │             │
│   │  Imports:        │  │  Imports:        │  │                  │             │
│   │  - @shared/types │  │  - @shared/types │  │  Imports:        │             │
│   │  - @shared/      │  │  - @shared/      │  │  - @shared/types │             │
│   │    constants     │  │    constants     │  │  - @shared/      │             │
│   │  - @shared/      │  │  - @shared/      │  │    constants     │             │
│   │    validation    │  │    validation    │  │                  │             │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘             │
│                                                                                 │
│   ┌──────────────────┐                                                         │
│   │  sam3-service/   │  ← No shared dependency (Python)                        │
│   │                  │                                                         │
│   │  Self-contained  │                                                         │
│   └──────────────────┘                                                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Frontend Internal Dependencies

From implementation notes - shows which files import what:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      FRONTEND INTERNAL DEPENDENCIES                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   CONFIG LAYER (imported by everything)                                        │
│   ──────────────────────────────────────                                       │
│   config/env.ts          → API URL, Firebase config                            │
│   config/firebase.ts     → Firebase SDK instances (auth, db, storage)          │
│   config/routes.ts       → Route path constants                                │
│   config/constants.ts    → App constants (shortcuts, timing)                   │
│                                                                                 │
│   API LAYER (imported by hooks)                                                │
│   ─────────────────────────────────                                            │
│   api/client.ts          → Base HTTP client                                    │
│       ├── Imports: config/env, config/firebase (auth)                          │
│       └── Used by: ALL api/*.ts files                                          │
│                                                                                 │
│   api/images.api.ts      → Image CRUD + upload                                 │
│       ├── Imports: client.ts, @shared/types                                    │
│       └── Used by: useImages, useUploadImages                                  │
│                                                                                 │
│   api/labeling.api.ts    → Masks + labeling session                            │
│       ├── Imports: client.ts, @shared/types                                    │
│       └── Used by: useMasks, useSaveMasks, LabelingPage                        │
│                                                                                 │
│   api/segmentation.api.ts → SAM3 proxy calls                                   │
│       ├── Imports: client.ts, @shared/types                                    │
│       └── Used by: useSegment                                                  │
│                                                                                 │
│   STORE LAYER (imported by hooks + components)                                 │
│   ────────────────────────────────────────────                                 │
│   store/slices/masksSlice.ts                                                   │
│       ├── Imports: zustand, @/types (WorkingMask)                              │
│       └── Used by: useMaskEditor, useSaveMasks, LabelingCanvas                 │
│                                                                                 │
│   store/slices/canvasSlice.ts                                                  │
│       ├── Imports: zustand, @/types (Viewport, ToolType)                       │
│       └── Used by: LabelingCanvas, CanvasControls, ToolPalette                 │
│                                                                                 │
│   store/slices/toolSlice.ts                                                    │
│       ├── Imports: zustand, @/types (PolygonEditState)                         │
│       └── Used by: usePolygonEditor, useSegment, LabelingCanvas                │
│                                                                                 │
│   store/slices/historySlice.ts                                                 │
│       ├── Imports: zustand, @/types (HistoryAction)                            │
│       └── Used by: useMaskEditor, usePolygonEditor, useUndoRedo                │
│                                                                                 │
│   HOOKS LAYER (imported by components)                                         │
│   ────────────────────────────────────                                         │
│   hooks/mutations/useUploadImages.ts                                           │
│       ├── Imports: api/images.api, store/uiSlice, utils/file/validation        │
│       └── Used by: ImageUploader.tsx                                           │
│                                                                                 │
│   hooks/mutations/useSaveMasks.ts                                              │
│       ├── Imports: api/labeling.api, store/masksSlice, store/uiSlice           │
│       └── Used by: LabelingPage.tsx                                            │
│                                                                                 │
│   hooks/mutations/useSegment.ts                                                │
│       ├── Imports: api/segmentation.api, store/masksSlice, store/toolSlice     │
│       └── Used by: LabelingCanvas.tsx, SAMControls.tsx                         │
│                                                                                 │
│   hooks/canvas/usePolygonEditor.ts                                             │
│       ├── Imports: store/masksSlice, store/toolSlice, store/historySlice       │
│       ├── Imports: utils/geometry/polygon                                      │
│       └── Used by: LabelingCanvas.tsx                                          │
│                                                                                 │
│   hooks/canvas/useMaskEditor.ts                                                │
│       ├── Imports: store/masksSlice, store/historySlice, utils/geometry        │
│       └── Used by: LabelingCanvas.tsx, MaskList.tsx                            │
│                                                                                 │
│   COMPONENT LAYER                                                              │
│   ───────────────                                                              │
│   components/labeling/LabelingCanvas.tsx                                       │
│       ├── Imports: ALL store slices, usePolygonEditor, useMaskEditor           │
│       ├── Imports: useSegment, utils/geometry, utils/canvas                    │
│       └── Key component for annotation workflow                                │
│                                                                                 │
│   pages/labeling/LabelingPage.tsx                                              │
│       ├── Imports: api/labeling.api, useSaveMasks, store slices                │
│       ├── Imports: LabelingCanvas, MaskList, ToolPalette, etc.                 │
│       └── Main page orchestrating labeling session                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Backend Internal Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       BACKEND INTERNAL DEPENDENCIES                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   CONFIG LAYER                                                                 │
│   ────────────                                                                 │
│   config/firebase.ts     → Firebase Admin SDK (db, auth, storage)              │
│       └── Used by: ALL models, ALL services                                    │
│                                                                                 │
│   config/server.ts       → Server config (port, SAM3 URL, etc.)                │
│       └── Used by: index.ts, segment.service.ts                                │
│                                                                                 │
│   MIDDLEWARE LAYER (order matters!)                                            │
│   ─────────────────────────────────                                            │
│   Request flow: loggingMiddleware → authMiddleware → projectMiddleware         │
│                 → roleMiddleware → validationMiddleware → route handler        │
│                                                                                 │
│   middleware/auth.middleware.ts                                                │
│       ├── Imports: config/firebase (auth), utils/errors                        │
│       ├── Sets: req.user = { uid, email }                                      │
│       └── Used by: routes/index.ts (global)                                    │
│                                                                                 │
│   middleware/project.middleware.ts                                             │
│       ├── Imports: models/project.model, models/member.model, utils/errors     │
│       ├── Requires: req.user (from authMiddleware)                             │
│       ├── Sets: req.project, req.membership                                    │
│       └── Used by: routes/index.ts (project sub-routes)                        │
│                                                                                 │
│   middleware/role.middleware.ts                                                │
│       ├── Imports: @shared/constants (hasPermission), utils/errors             │
│       ├── Requires: req.membership (from projectMiddleware)                    │
│       └── Used by: routes that need admin/owner                                │
│                                                                                 │
│   middleware/validation.middleware.ts                                          │
│       ├── Imports: zod, utils/errors                                           │
│       └── Used by: routes with body/query validation                           │
│                                                                                 │
│   ROUTES LAYER                                                                 │
│   ────────────                                                                 │
│   routes/index.ts        → Aggregates all routes, applies middleware           │
│       ├── Imports: ALL middleware, ALL route modules                           │
│       └── Exports: createRouter()                                              │
│                                                                                 │
│   routes/labeling.routes.ts                                                    │
│       ├── Imports: middleware/validation, @shared/validation                   │
│       ├── Imports: services/labeling/mask.service                              │
│       ├── Imports: services/image/image.service                                │
│       └── Endpoints: /:imageId/for-labeling, /:imageId/masks, etc.            │
│                                                                                 │
│   routes/segment.routes.ts                                                     │
│       ├── Imports: services/segment/segment.service                            │
│       └── Endpoints: /click, /auto, /semantic                                  │
│                                                                                 │
│   SERVICES LAYER                                                               │
│   ──────────────                                                               │
│   services/segment/segment.service.ts                                          │
│       ├── Imports: config/server (SAM3 URL), services/storage                  │
│       ├── Functions: clickSegment(), autoSegment(), semanticSegment()          │
│       └── Calls: SAM3 Cloud Run service via HTTP                               │
│                                                                                 │
│   services/labeling/mask.service.ts                                            │
│       ├── Imports: config/firebase (db), models/mask.model                     │
│       ├── Imports: services/labeling/combinedMask.service                      │
│       ├── Functions: getMasks(), saveMasks(), deleteMasks()                    │
│       └── Triggers: combined mask generation after save                        │
│                                                                                 │
│   services/assignment/assignment.service.ts                                    │
│       ├── Imports: config/firebase, models/image.model, models/member.model    │
│       ├── Imports: services/assignment/lock.service                            │
│       ├── Functions: assign(), getMyQueue(), releaseImages()                   │
│       └── Triggers: lock refresh after assignment changes                      │
│                                                                                 │
│   MODELS LAYER                                                                 │
│   ────────────                                                                 │
│   models/mask.model.ts                                                         │
│       ├── Imports: config/firebase (db)                                        │
│       └── Functions: getMasksCollection(), Firestore converters                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Runtime Service Communication

From interaction flows in documentation:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      RUNTIME SERVICE COMMUNICATION                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   LABELING SESSION FLOW (Section 5.1)                                          │
│   ───────────────────────────────────                                          │
│                                                                                 │
│   Browser                                                                       │
│     │                                                                           │
│     │ 1. GET /projects/:id/images/:id/for-labeling                             │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ ├── imageService.getImage()       → Firestore                            │
│     │ ├── maskService.getMasks()        → Firestore                            │
│     │ └── uploadService.getSignedUrl()  → Storage                              │
│     │                                                                           │
│     │ 2. POST /segment/click (when user clicks SAM)                            │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── segmentService.clickSegment()                                        │
│     │       ├── resolveImageUrl()       → Storage (signed URL)                 │
│     │       └── callSAM3('/click')      → SAM3 Service                         │
│     ▼                                                                           │
│   SAM3 Service (Cloud Run GPU)                                                  │
│     │ ├── load_image_from_url()         → HTTP fetch                           │
│     │ ├── predictor.predict_click()     → GPU inference                        │
│     │ └── mask_to_polygon()             → Post-process                         │
│     │                                                                           │
│     │ 3. POST /projects/:id/images/:id/masks (save)                            │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── maskService.saveMasks()                                              │
│     │       ├── db.runTransaction()     → Firestore (atomic)                   │
│     │       └── generateCombinedMask()  → Cloud Tasks                          │
│     │                                                                           │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   POLYGON EDITING FLOW (Section 5.4) - Frontend Only                           │
│   ──────────────────────────────────────────────────                           │
│                                                                                 │
│   No backend calls until Save:                                                 │
│     usePolygonEditor.moveVertex()   → useMasksStore (local state)              │
│     usePolygonEditor.addVertex()    → useMasksStore (local state)              │
│     usePolygonEditor.deleteVertex() → useMasksStore (local state)              │
│     useHistoryStore.pushAction()    → Local undo stack                         │
│                                                                                 │
│   On Save: Same as labeling flow step 3                                        │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   IMAGE UPLOAD FLOW (Section 5.2)                                              │
│   ───────────────────────────────                                              │
│                                                                                 │
│   Browser                                                                       │
│     │ 1. POST /projects/:id/images/upload-urls                                 │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── uploadService.getUploadUrls() → Storage (signed URLs)                │
│     │                                                                           │
│     │ 2. PUT to signed URLs (direct to Storage, parallel)                      │
│     ▼                                                                           │
│   Firebase Storage (direct upload, bypasses backend)                            │
│     │                                                                           │
│     │ 3. POST /projects/:id/images/confirm-upload                              │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── uploadService.confirmUpload() → Firestore (create docs)              │
│     │                                                                           │
│   Firestore Trigger                                                             │
│     │ └── onImageCreate Cloud Function                                         │
│     │       ├── downloadFile()          → Storage                              │
│     │       ├── sharp.resize()          → Generate thumbnail                   │
│     │       ├── uploadFile()            → Storage                              │
│     │       └── updateImage()           → Firestore                            │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   EXPORT FLOW (Section 5.3)                                                    │
│   ─────────────────────────                                                    │
│                                                                                 │
│   Browser                                                                       │
│     │ 1. POST /projects/:id/export                                             │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── exportService.startExport()   → Firestore (create job)               │
│     │                                                                           │
│   Firestore Trigger                                                             │
│     │ └── onExportCreate Cloud Function                                        │
│     │       └── createTask()            → Cloud Tasks                          │
│     │                                                                           │
│   Cloud Tasks                                                                   │
│     │ └── processExportJob()                                                   │
│     │       ├── getMasks() per image    → Firestore                            │
│     │       ├── writeToZip()            → Memory/Temp                          │
│     │       ├── uploadToStorage()       → Storage                              │
│     │       └── updateExportJob()       → Firestore (progress, URL)            │
│     │                                                                           │
│   Browser (polling)                                                             │
│     │ 2. GET /projects/:id/export/:id (every 5s)                               │
│     ▼                                                                           │
│   Backend API                                                                   │
│     │ └── Returns { status, progress, downloadUrl }                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Build Order & Process

### 3.1 Strict Build Order

```bash
# Must build in this order due to dependencies

# Step 1: Shared (no dependencies)
cd shared
pnpm install
pnpm build
# Output: shared/dist/
#   ├── types/index.js, index.d.ts
#   ├── constants/index.js, index.d.ts
#   └── validation/index.js, index.d.ts

# Step 2a: Frontend (depends on shared)
cd frontend
pnpm install  # Links @rocam/shared from workspace
pnpm build
# Output: frontend/dist/ (static files for hosting)

# Step 2b: Backend (depends on shared) - can parallel with 2a
cd backend
pnpm install  # Links @rocam/shared from workspace
pnpm build
# Output: backend/dist/ (Node.js bundle)

# Step 2c: Cloud Functions (depends on shared) - can parallel with 2a, 2b
cd functions
pnpm install
pnpm build
# Output: functions/lib/

# Step 3: SAM3 Service (independent, can build anytime)
cd sam3-service
pip install -r requirements.txt
# No build step for Python, just package
```

### 3.2 Monorepo Configuration

**Root package.json:**
```json
{
  "name": "rocam-labeler",
  "private": true,
  "workspaces": [
    "shared",
    "frontend",
    "backend",
    "functions"
  ],
  "scripts": {
    "build:shared": "pnpm --filter @rocam/shared build",
    "build:frontend": "pnpm --filter @rocam/frontend build",
    "build:backend": "pnpm --filter @rocam/backend build",
    "build:functions": "pnpm --filter @rocam/functions build",
    "build:all": "pnpm build:shared && pnpm build:frontend && pnpm build:backend && pnpm build:functions",
    "dev": "pnpm --parallel --filter './frontend' --filter './backend' dev",
    "test": "pnpm --recursive test",
    "lint": "pnpm --recursive lint"
  }
}
```

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'shared'
  - 'frontend'
  - 'backend'
  - 'functions'
```

**shared/package.json:**
```json
{
  "name": "@rocam/shared",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./types": "./dist/types/index.js",
    "./constants": "./dist/constants/index.js",
    "./validation": "./dist/validation/index.js"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**frontend/package.json:**
```json
{
  "name": "@rocam/frontend",
  "dependencies": {
    "@rocam/shared": "workspace:*",
    "react": "^18.2.0",
    "zustand": "^4.4.0",
    "firebase": "^10.7.0"
  }
}
```

**backend/package.json:**
```json
{
  "name": "@rocam/backend",
  "dependencies": {
    "@rocam/shared": "workspace:*",
    "express": "^4.18.0",
    "firebase-admin": "^12.0.0",
    "zod": "^3.22.0",
    "sharp": "^0.33.0"
  }
}
```

---

## 4. Service Configuration

### 4.1 Environment Variables

Based on implementation notes showing what each module imports:

**Frontend (.env.production):**
```bash
# Used by: config/env.ts
VITE_API_URL=https://labeler-backend-xxx.run.app

# Used by: config/firebase.ts
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=rocam-labeler.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rocam-labeler
VITE_FIREBASE_STORAGE_BUCKET=rocam-labeler.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

**Backend (Cloud Run env vars):**
```bash
# Used by: config/server.ts
PORT=8080
PROJECT_ID=rocam-labeler
REGION=us-central1

# Used by: services/segment/segment.service.ts
SAM3_SERVICE_URL=https://labeler-sam3-xxx.run.app

# Used by: services/export/export.service.ts, Cloud Functions
CLOUD_TASKS_QUEUE=projects/rocam-labeler/locations/us-central1/queues/export-queue
BACKEND_URL=https://labeler-backend-xxx.run.app

# Used by: middleware/auth.middleware.ts (implicit via Firebase Admin)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# Or use default credentials on Cloud Run

# Used by: routes/index.ts (CORS)
CORS_ORIGINS=https://rocam-labeler.web.app,https://rocam-labeler.firebaseapp.com
```

**SAM3 Service (Cloud Run env vars):**
```bash
# Used by: model/loader.py
MODEL_WEIGHTS_PATH=/weights/sam3.pth

# Used by: utils/storage.py
GOOGLE_CLOUD_PROJECT=rocam-labeler
GCS_BUCKET=rocam-labeler.appspot.com
```

**Cloud Functions (.env or Firebase config):**
```bash
# Used by: onExportCreate.ts, onMaskWrite.ts
BACKEND_URL=https://labeler-backend-xxx.run.app
PROJECT_ID=rocam-labeler
REGION=us-central1
```

### 4.2 Firebase Configuration

**firebase.json:**
```json
{
  "firestore": {
    "rules": "infrastructure/firebase/firestore.rules",
    "indexes": "infrastructure/firebase/firestore.indexes.json"
  },
  "storage": {
    "rules": "infrastructure/firebase/storage.rules"
  },
  "hosting": {
    "public": "frontend/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css)",
        "headers": [
          { "key": "Cache-Control", "value": "max-age=31536000" }
        ]
      }
    ]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs18",
    "predeploy": [
      "npm --prefix \"$RESOURCE_DIR\" run build"
    ]
  }
}
```

### 4.3 Firestore Indexes

Based on query patterns from services:

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "images",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "uploadedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "images",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedTo", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "assignedAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "images",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedTo", "order": "ASCENDING" },
        { "fieldPath": "assignedAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "images",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "lockState.locked", "order": "ASCENDING" },
        { "fieldPath": "lockState.expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "members",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "exports",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## 5. Deployment Targets

### 5.1 Deployment Matrix

| Module | Target | URL Pattern | Deploy Command |
|--------|--------|-------------|----------------|
| `shared/` | (built into others) | N/A | `pnpm build` |
| `frontend/` | Firebase Hosting | `rocam-labeler.web.app` | `firebase deploy --only hosting` |
| `backend/` | Cloud Run | `labeler-backend-xxx.run.app` | `gcloud run deploy` |
| `functions/` | Cloud Functions | (triggered) | `firebase deploy --only functions` |
| `sam3-service/` | Cloud Run (GPU) | `labeler-sam3-xxx.run.app` | `gcloud run deploy --gpu 1` |
| Firebase rules | Firestore/Storage | N/A | `firebase deploy --only firestore,storage` |

### 5.2 Cloud Run Configurations

**Backend API (labeler-backend):**
```bash
gcloud run deploy labeler-backend \
  --image gcr.io/${PROJECT_ID}/labeler-backend:${VERSION} \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 10 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --timeout 60s \
  --set-env-vars "PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars "REGION=us-central1" \
  --set-env-vars "SAM3_SERVICE_URL=https://labeler-sam3-xxx.run.app" \
  --set-env-vars "CORS_ORIGINS=https://rocam-labeler.web.app"
```

**SAM3 Service (labeler-sam3):**
```bash
gcloud run deploy labeler-sam3 \
  --image gcr.io/${PROJECT_ID}/labeler-sam3:${VERSION} \
  --platform managed \
  --region us-central1 \
  --no-allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --cpu 4 \
  --memory 16Gi \
  --gpu 1 \
  --gpu-type nvidia-l4 \
  --timeout 300s \
  --concurrency 1 \
  --service-account sam3-invoker@${PROJECT_ID}.iam.gserviceaccount.com
```

### 5.3 Docker Configurations

**backend/Dockerfile:**
```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared ./shared
COPY backend ./backend

# Install and build
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rocam/shared build
RUN pnpm --filter @rocam/backend build

# Production stage
FROM node:18-alpine
WORKDIR /app

# Copy built files
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/dist ./node_modules/@rocam/shared/dist

# Install sharp for image processing (needs native deps)
RUN apk add --no-cache vips-dev
RUN npm rebuild sharp

EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

**sam3-service/Dockerfile:**
```dockerfile
FROM nvidia/cuda:12.1-runtime-ubuntu22.04

# Install Python and system deps
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src ./src

# Download or copy model weights
# Option 1: Copy from build context (larger image)
COPY weights ./weights
# Option 2: Download at startup (slower cold start)
# RUN python -c "from src.model.loader import download_weights; download_weights()"

EXPOSE 8080
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## 6. CI/CD Pipeline

### 6.1 GitHub Actions Workflow

**.github/workflows/deploy.yml:**
```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      deploy_sam3:
        description: 'Deploy SAM3 service'
        type: boolean
        default: false

env:
  PROJECT_ID: rocam-labeler
  REGION: us-central1

jobs:
  # ═══════════════════════════════════════════════════════════════════
  # BUILD SHARED (must complete first)
  # ═══════════════════════════════════════════════════════════════════
  build-shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build shared
        run: pnpm --filter @rocam/shared build
      
      - name: Upload shared dist
        uses: actions/upload-artifact@v4
        with:
          name: shared-dist
          path: shared/dist
          retention-days: 1

  # ═══════════════════════════════════════════════════════════════════
  # DEPLOY FRONTEND (depends on shared)
  # ═══════════════════════════════════════════════════════════════════
  deploy-frontend:
    needs: build-shared
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/download-artifact@v4
        with:
          name: shared-dist
          path: shared/dist
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build frontend
        run: pnpm --filter @rocam/frontend build
        env:
          VITE_API_URL: https://labeler-backend-${{ env.PROJECT_ID }}.run.app
          VITE_FIREBASE_API_KEY: ${{ secrets.FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ env.PROJECT_ID }}.firebaseapp.com
          VITE_FIREBASE_PROJECT_ID: ${{ env.PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ env.PROJECT_ID }}.appspot.com
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.FIREBASE_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.FIREBASE_APP_ID }}
      
      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: ${{ env.PROJECT_ID }}

  # ═══════════════════════════════════════════════════════════════════
  # DEPLOY BACKEND (depends on shared)
  # ═══════════════════════════════════════════════════════════════════
  deploy-backend:
    needs: build-shared
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/download-artifact@v4
        with:
          name: shared-dist
          path: shared/dist
      
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - uses: google-github-actions/setup-gcloud@v2
      
      - name: Configure Docker
        run: gcloud auth configure-docker gcr.io
      
      - name: Build Docker image
        run: |
          docker build \
            -t gcr.io/${{ env.PROJECT_ID }}/labeler-backend:${{ github.sha }} \
            -t gcr.io/${{ env.PROJECT_ID }}/labeler-backend:latest \
            -f backend/Dockerfile \
            .
      
      - name: Push Docker image
        run: |
          docker push gcr.io/${{ env.PROJECT_ID }}/labeler-backend:${{ github.sha }}
          docker push gcr.io/${{ env.PROJECT_ID }}/labeler-backend:latest
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy labeler-backend \
            --image gcr.io/${{ env.PROJECT_ID }}/labeler-backend:${{ github.sha }} \
            --platform managed \
            --region ${{ env.REGION }} \
            --allow-unauthenticated \
            --set-env-vars "PROJECT_ID=${{ env.PROJECT_ID }}" \
            --set-env-vars "REGION=${{ env.REGION }}" \
            --set-env-vars "SAM3_SERVICE_URL=https://labeler-sam3-${{ env.PROJECT_ID }}.run.app"

  # ═══════════════════════════════════════════════════════════════════
  # DEPLOY CLOUD FUNCTIONS (depends on shared)
  # ═══════════════════════════════════════════════════════════════════
  deploy-functions:
    needs: build-shared
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/download-artifact@v4
        with:
          name: shared-dist
          path: shared/dist
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build functions
        run: pnpm --filter @rocam/functions build
      
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Deploy Cloud Functions
        run: |
          npm install -g firebase-tools
          firebase deploy --only functions --project ${{ env.PROJECT_ID }}

  # ═══════════════════════════════════════════════════════════════════
  # DEPLOY SAM3 (manual trigger, expensive GPU)
  # ═══════════════════════════════════════════════════════════════════
  deploy-sam3:
    if: github.event.inputs.deploy_sam3 == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - uses: google-github-actions/setup-gcloud@v2
      
      - name: Configure Docker
        run: gcloud auth configure-docker gcr.io
      
      - name: Build Docker image
        run: |
          docker build \
            -t gcr.io/${{ env.PROJECT_ID }}/labeler-sam3:${{ github.sha }} \
            -t gcr.io/${{ env.PROJECT_ID }}/labeler-sam3:latest \
            -f sam3-service/Dockerfile \
            sam3-service/
      
      - name: Push Docker image
        run: |
          docker push gcr.io/${{ env.PROJECT_ID }}/labeler-sam3:${{ github.sha }}
          docker push gcr.io/${{ env.PROJECT_ID }}/labeler-sam3:latest
      
      - name: Deploy to Cloud Run with GPU
        run: |
          gcloud run deploy labeler-sam3 \
            --image gcr.io/${{ env.PROJECT_ID }}/labeler-sam3:${{ github.sha }} \
            --platform managed \
            --region ${{ env.REGION }} \
            --no-allow-unauthenticated \
            --cpu 4 \
            --memory 16Gi \
            --gpu 1 \
            --gpu-type nvidia-l4 \
            --min-instances 0 \
            --max-instances 3 \
            --timeout 300s \
            --concurrency 1

  # ═══════════════════════════════════════════════════════════════════
  # DEPLOY FIREBASE RULES (on changes)
  # ═══════════════════════════════════════════════════════════════════
  deploy-rules:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.modified, 'infrastructure/firebase/')
    steps:
      - uses: actions/checkout@v4
      
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Deploy Firestore & Storage rules
        run: |
          npm install -g firebase-tools
          firebase deploy --only firestore:rules,firestore:indexes,storage --project ${{ env.PROJECT_ID }}
```

---

## 7. Local Development

### 7.1 Development Setup

```bash
# Clone repository
git clone https://github.com/rocam/labeler.git
cd labeler

# Install all dependencies
pnpm install

# Copy environment files
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env

# Start Firebase emulators (Firestore, Auth, Storage)
firebase emulators:start

# Terminal 1: Watch shared (rebuilds on changes)
cd shared && pnpm watch

# Terminal 2: Backend dev server
cd backend && pnpm dev
# Runs on http://localhost:8080

# Terminal 3: Frontend dev server
cd frontend && pnpm dev
# Runs on http://localhost:5173
# Proxies API to localhost:8080

# Terminal 4 (optional): SAM3 service
cd sam3-service
python -m uvicorn src.api.main:app --reload --port 8081
```

### 7.2 Development Environment Files

**frontend/.env.local:**
```bash
VITE_API_URL=http://localhost:8080
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=demo-rocam-labeler
VITE_FIREBASE_STORAGE_BUCKET=demo-rocam-labeler.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=demo
VITE_USE_EMULATORS=true
```

**backend/.env:**
```bash
PORT=8080
PROJECT_ID=demo-rocam-labeler
REGION=us-central1
SAM3_SERVICE_URL=http://localhost:8081
CORS_ORIGINS=http://localhost:5173
FIRESTORE_EMULATOR_HOST=localhost:8081
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
```

### 7.3 VS Code Configuration

**.vscode/settings.json:**
```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

**.vscode/launch.json:**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "cwd": "${workspaceFolder}/backend",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "console": "integratedTerminal"
    },
    {
      "type": "chrome",
      "request": "launch",
      "name": "Debug Frontend",
      "url": "http://localhost:5173",
      "webRoot": "${workspaceFolder}/frontend/src"
    }
  ]
}
```

---

## 8. Testing Strategy

### 8.1 Test Structure by Flow

Based on interaction flows documented:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TESTING STRATEGY BY FLOW                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   LABELING SESSION FLOW                                                        │
│   ─────────────────────                                                        │
│   Unit Tests:                                                                  │
│   ├── useMasksStore.test.ts    - addMask, updateMask, deleteMask              │
│   ├── usePolygonEditor.test.ts - moveVertex, addVertex, deleteVertex          │
│   ├── useHistoryStore.test.ts  - pushAction, undo, redo                       │
│   └── mask.service.test.ts     - saveMasks transaction                        │
│                                                                                 │
│   Integration Tests:                                                           │
│   ├── LabelingPage.integration.test.tsx                                       │
│   │   - Load image + masks                                                    │
│   │   - Save masks flow                                                       │
│   │   - Status update flow                                                    │
│   └── labeling.routes.test.ts                                                 │
│       - GET /for-labeling returns image + masks + signedUrl                   │
│       - POST /masks saves correctly                                           │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   POLYGON EDITING FLOW                                                         │
│   ────────────────────                                                         │
│   Unit Tests:                                                                  │
│   ├── geometry/polygon.test.ts                                                │
│   │   - pointToLineDistance                                                   │
│   │   - pointInPolygon                                                        │
│   │   - simplifyPolygon                                                       │
│   ├── usePolygonEditor.test.ts                                                │
│   │   - findNearestVertex                                                     │
│   │   - findNearestEdge                                                       │
│   │   - startDrag/updateDrag/endDrag                                          │
│   └── toolSlice.test.ts                                                       │
│       - PolygonEditState transitions                                          │
│       - PolygonDrawState transitions                                          │
│                                                                                 │
│   Integration Tests:                                                           │
│   └── LabelingCanvas.integration.test.tsx                                     │
│       - Click vertex → drag → release → undo                                  │
│       - Click edge → add vertex                                               │
│       - Draw new polygon flow                                                 │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   SAM3 SEGMENTATION FLOW                                                       │
│   ──────────────────────                                                       │
│   Unit Tests:                                                                  │
│   ├── useSegment.test.ts       - clickSegment, autoSegment state changes      │
│   ├── segment.service.test.ts  - URL resolution, error handling               │
│   └── postprocess.test.ts      - mask_to_polygon, calculate_bbox              │
│                                                                                 │
│   Integration Tests:                                                           │
│   └── segment.routes.test.ts                                                  │
│       - Mock SAM3 service responses                                           │
│       - Verify request forwarding                                             │
│                                                                                 │
│   E2E Tests:                                                                   │
│   └── sam3.e2e.test.ts (requires GPU)                                         │
│       - Real inference on test image                                          │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   IMAGE UPLOAD FLOW                                                            │
│   ─────────────────                                                            │
│   Unit Tests:                                                                  │
│   ├── useUploadImages.test.ts  - progress tracking, error handling            │
│   ├── upload.service.test.ts   - signed URL generation                        │
│   └── file/validation.test.ts  - MIME type, size validation                   │
│                                                                                 │
│   Integration Tests:                                                           │
│   ├── images.routes.test.ts                                                   │
│   │   - upload-urls returns valid signed URLs                                 │
│   │   - confirm-upload creates documents                                      │
│   └── onImageCreate.test.ts (Cloud Function)                                  │
│       - Thumbnail generation                                                  │
│       - Dimension extraction                                                  │
│                                                                                 │
│   ──────────────────────────────────────────────────────────────────────────── │
│                                                                                 │
│   EXPORT FLOW                                                                  │
│   ───────────                                                                  │
│   Unit Tests:                                                                  │
│   ├── cocoExporter.test.ts     - COCO JSON format                             │
│   ├── yoloExporter.test.ts     - YOLO format                                  │
│   └── exportJob.model.test.ts  - status transitions                           │
│                                                                                 │
│   Integration Tests:                                                           │
│   ├── export.routes.test.ts                                                   │
│   │   - Start export creates job                                              │
│   │   - Status polling returns correct state                                  │
│   └── processExportJob.test.ts                                                │
│       - Full export with mock data                                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Test Commands

```bash
# Run all tests
pnpm test

# Run tests by module
pnpm --filter @rocam/shared test
pnpm --filter @rocam/frontend test
pnpm --filter @rocam/backend test

# Run specific test file
pnpm --filter @rocam/frontend test src/hooks/canvas/usePolygonEditor.test.ts

# Run with coverage
pnpm test -- --coverage

# Run E2E tests (requires running services)
pnpm e2e
```

---

## Summary: Deployment Checklist

```
□ 1. Infrastructure Setup (one-time)
    □ terraform init && terraform apply
    □ firebase deploy --only firestore:rules,firestore:indexes,storage

□ 2. Build Shared Module
    □ pnpm --filter @rocam/shared build
    □ Verify dist/ contains types, constants, validation

□ 3. Deploy Frontend
    □ pnpm --filter @rocam/frontend build
    □ firebase deploy --only hosting
    □ Verify: https://rocam-labeler.web.app loads

□ 4. Deploy Backend
    □ docker build + push
    □ gcloud run deploy labeler-backend
    □ Verify: /health returns { status: 'ok' }

□ 5. Deploy Cloud Functions
    □ pnpm --filter @rocam/functions build
    □ firebase deploy --only functions
    □ Verify: Functions appear in Firebase Console

□ 6. Deploy SAM3 Service (when needed)
    □ docker build + push
    □ gcloud run deploy labeler-sam3 --gpu 1
    □ Verify: Backend can reach SAM3

□ 7. Smoke Test
    □ Register new user
    □ Create project
    □ Upload image → thumbnail appears
    □ Label image with SAM click → mask created
    □ Edit polygon vertices
    □ Save masks
    □ Export COCO JSON
```

---

*End of Deployment Architecture v2*
