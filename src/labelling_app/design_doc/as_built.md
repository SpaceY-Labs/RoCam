# Labelling App As-Built Architecture and API Contracts

This document captures the current implementation as found in the repo. It is
intended to lock module boundaries and API contracts to what is actually
implemented today. The target architecture is described in
`src/labelling_app/design_doc/deployment_architecture.md`.

## Module Boundaries (As-Built)

### Frontend
- Location: `src/labelling_app/frontend`
- Entry: `src/labelling_app/frontend/src/main.tsx`
- UI: `src/labelling_app/frontend/src/App.tsx` renders a single upload button.
- Current responsibilities:
  - Anonymous Firebase auth.
  - Direct upload to Firebase Storage via client SDK.
  - No backend API calls are wired from the UI yet.

### Backend API
- Location: `src/labelling_app/backend`
- Entry: `src/labelling_app/backend/src/index.ts`
- Express server with route stubs for core endpoints.
- Only `labeling.routes.ts` and `segment.routes.ts` perform real work.

### Shared Package
- Location: `src/labelling_app/shared`
- Purpose: shared types, constants, validation schemas.
- Build output exists under `src/labelling_app/shared/dist`.

### Cloud Functions
- Location: `src/labelling_app/functions`
- Firebase Functions scaffolding with TypeScript build output under
  `src/labelling_app/functions/lib`.

### SAM3 Service
- Location: `src/labelling_app/sam3-service`
- Python service (no build artifacts in repo).

### Infrastructure
- Location: `src/labelling_app/infrastructure`
- Placeholder folder (no files present).

### Model Archiver
- Location: `src/labelling_app/model_archiver`
- Utility scripts and artifacts for model packaging.

## Backend API Contracts (As-Built)

Base path: server root. Project-scoped routes are under `/projects/:projectId`.
All responses are JSON. Stubbed endpoints return fixed placeholder payloads.

### Health
- `GET /health`
  - Response: `{ "status": "ok" }`

### Auth
- `POST /auth/sync`
  - Response: `{ "success": true }`
- `GET /auth/profile`
  - Response: `{ "success": true, "data": <user|null> }`
- `PATCH /auth/profile`
  - Response: `{ "success": true }`

### Projects
- `GET /projects`
  - Response: `[]`
- `POST /projects`
  - Response: `{ "success": true }`
- `GET /projects/:projectId`
  - Response: `{ "success": true }`
- `PATCH /projects/:projectId`
  - Response: `{ "success": true }`
- `DELETE /projects/:projectId`
  - Response: `{ "success": true }`
- `GET /projects/:projectId/stats`
  - Response: `{ "success": true }`

### Members
- `GET /projects/:projectId/members`
  - Response: `[]`
- `POST /projects/:projectId/members`
  - Response: `{ "success": true }`
- `PATCH /projects/:projectId/members/:userId`
  - Response: `{ "success": true }`
- `DELETE /projects/:projectId/members/:userId`
  - Response: `{ "success": true }`
- `POST /projects/:projectId/members/leave`
  - Response: `{ "success": true }`

### Classes
- `GET /projects/:projectId/classes`
  - Response: `[]`
- `POST /projects/:projectId/classes`
  - Response: `{ "success": true }`
- `PATCH /projects/:projectId/classes/:classId`
  - Response: `{ "success": true }`
- `DELETE /projects/:projectId/classes/:classId`
  - Response: `{ "success": true }`
- `POST /projects/:projectId/classes/reorder`
  - Response: `{ "success": true }`

### Images
- `GET /projects/:projectId/images`
  - Response: `{ "items": [], "cursor": null, "hasMore": false }`
- `POST /projects/:projectId/images/upload-urls`
  - Response: `[]`
- `POST /projects/:projectId/images/confirm-upload`
  - Response: `{ "success": true }`
- `GET /projects/:projectId/images/:imageId`
  - Response: `{ "success": true }`
- `DELETE /projects/:projectId/images/:imageId`
  - Response: `{ "success": true }`
- `POST /projects/:projectId/images/bulk-delete`
  - Response: `{ "success": true }`

### Assignment
- `POST /projects/:projectId/assign`
  - Response: `{ "success": true, "assigned": {}, "summary": { "totalMoved": 0, "poolRemaining": 0 } }`
- `GET /projects/:projectId/my-queue`
  - Response: `[]`
- `POST /projects/:projectId/release`
  - Response: `{ "released": 0 }`
- `POST /projects/:projectId/refresh-locks`
  - Response: `{ "success": true }`

### Labeling
- `GET /projects/:projectId/images/:imageId/for-labeling`
  - Response: `{ "image": <Image>, "masks": <Mask[]>, "signedImageUrl": <string> }`
- `GET /projects/:projectId/images/:imageId/masks`
  - Response: `<Mask[]>`
- `POST /projects/:projectId/images/:imageId/masks`
  - Request: `{ "masks": [...] }` (validated by `shared/validation/saveMasksSchema`)
  - Response: `<Mask[]>`

### Segmentation (SAM3 proxy)
- `POST /segment/click`
  - Request: `{ "imageUrl": <string>, "points": <Point[]>, "box": <Box|undefined> }`
  - Response: `<SegmentationResult>`
- `POST /segment/auto`
  - Request: `{ "imageUrl": <string> }`
  - Response: `<SegmentationResult>`
- `POST /segment/semantic`
  - Request: `{ "imageUrl": <string>, "prompt": <string> }`
  - Response: `<SegmentationResult>`

### Export
- `POST /projects/:projectId/export`
  - Response: `{ "success": true }`
- `GET /projects/:projectId/export/:exportId`
  - Response: `{ "success": true }`
- `GET /projects/:projectId/export`
  - Response: `[]`
- `DELETE /projects/:projectId/export/:exportId`
  - Response: `{ "success": true }`

### Analytics
- `GET /projects/:projectId/analytics`
  - Response: `{ "success": true }`
- `GET /projects/:projectId/analytics/team`
  - Response: `[]`
- `GET /projects/:projectId/analytics/me`
  - Response: `{ "success": true }`

## Alignment Notes
- The frontend currently uploads directly to Firebase Storage and does not call
  the backend API endpoints above.
- Many backend routes are placeholders and do not yet implement the contracts
  described in `module_doc.md`.
