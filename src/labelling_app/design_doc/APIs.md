# RoCam Labeler API Documentation

**Version:** 1.0  
**Base URL:** `/api`

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Projects](#projects)
4. [Images](#images)
5. [Locks](#locks)
6. [Segmentation (SAM3)](#segmentation-sam3)
7. [Data Types](#data-types)
8. [Error Responses](#error-responses)

---

## Overview

The RoCam Labeler API provides endpoints for managing image annotation projects with AI-assisted segmentation using SAM3.

### Architecture

```
Frontend (React)
     |
     v
Backend API (Cloud Run - Node/Express + SAM3 GPU)
     | \
     |  \
     v   v
Firestore (metadata)
Storage (image files)
```

---

## Authentication

All endpoints (except `/health`) require Firebase Authentication.

**Header:**
```
Authorization: Bearer <firebase_id_token>
```

**Error Response (401):**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or expired token"
}
```

---

## Projects

### Create Project

Creates a new annotation project.

```
POST /api/projects
```

**Request Body:**
```json
{
  "name": "string",
  "description": "string | null",
  "classes": [
    {
      "id": "string",
      "name": "string",
      "color": "string"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name |
| `description` | string | No | Project description |
| `classes` | array | Yes | Label classes for annotations |
| `classes[].id` | string | Yes | Unique class identifier |
| `classes[].name` | string | Yes | Display name |
| `classes[].color` | string | Yes | Hex color code (e.g., "#FF0000") |

**Response (201):**
```json
{
  "projectId": "proj_abc123"
}
```

---

### Get Project

Retrieves a single project by ID.

```
GET /api/projects/:projectId
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |

**Response (200):**
```json
{
  "projectId": "proj_abc123",
  "name": "My Project",
  "description": "Project description",
  "classes": [
    {
      "id": "cls_001",
      "name": "Person",
      "color": "#FF0000"
    },
    {
      "id": "cls_002",
      "name": "Vehicle",
      "color": "#00FF00"
    }
  ]
}
```

---

### Update Project

Updates the project name/description/classes.

```
PATCH /api/projects/:projectId
```

**Request Body (partial):**
```json
{
  "name": "string",
  "description": "string | null",
  "classes": [
    {
      "id": "string",
      "name": "string",
      "color": "string"
    }
  ]
}
```

**Response (200):**
```json
{
  "projectId": "proj_abc123"
}
```

---

### List Projects

Lists all projects for the authenticated user.

```
GET /api/projects
```

**Response (200):**
```json
{
  "items": [
    {
      "projectId": "proj_abc123",
      "name": "My Project",
      "description": "Project description"
    },
    {
      "projectId": "proj_def456",
      "name": "Another Project",
      "description": null
    }
  ]
}
```

---

## Images

### Upload Image Package

Uploads an image with its metadata and masks.

```
POST /api/projects/:projectId/images
```

**Content-Type:** `multipart/form-data`

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |

**Request Body (multipart):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imageData` | File | Yes | Raw image file (PNG, JPEG) |
| `imageId` | string | No | Existing ID for updates, omit for new |
| `videoId` | string | No | Parent video ID, null if standalone |
| `masks` | JSON string | No | Array of mask objects |
| `labellerId` | string | No | User ID who labeled this |
| `meta` | JSON string | Yes | Image metadata object |

**Meta Object:**
```json
{
  "fileName": "image001.png",
  "width": 1920,
  "height": 1080,
  "status": "unlabeled",
  "tags": ["outdoor", "daytime"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileName` | string | Yes | Original filename |
| `width` | number | Yes | Image width in pixels |
| `height` | number | Yes | Image height in pixels |
| `status` | string | Yes | One of: `unlabeled`, `in_progress`, `labeled` |
| `tags` | array | No | Optional tags for filtering |

**Response (201):**
```json
{
  "imageId": "img_xyz789"
}
```

---

### Get Image Metadata

Retrieves metadata for a single image (without the file).

```
GET /api/projects/:projectId/images/:imageId
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |
| `imageId` | string | Image identifier |

**Response (200):**
```json
{
  "imageId": "img_xyz789",
  "videoId": "vid_001",
  "masks": [
    {
      "id": "mask_001",
      "classId": "cls_001",
      "className": "Person",
      "color": "#FF0000",
      "polygon": [
        [
          {"x": 100, "y": 100},
          {"x": 200, "y": 100},
          {"x": 200, "y": 200},
          {"x": 100, "y": 200}
        ]
      ],
      "source": "sam3_click"
    }
  ],
  "labellerId": "user_123",
  "meta": {
    "fileName": "image001.png",
    "width": 1920,
    "height": 1080,
    "status": "labeled",
    "tags": ["outdoor"]
  }
}
```

---

### Update Image Metadata / Masks

Updates masks, labeller assignment, or metadata fields.

```
PATCH /api/projects/:projectId/images/:imageId
```

**Request Body (partial):**
```json
{
  "masks": [
    {
      "id": "mask_001",
      "classId": "cls_001",
      "className": "Person",
      "color": "#FF0000",
      "polygon": [[{"x": 1, "y": 2}, {"x": 2, "y": 3}, {"x": 3, "y": 1}]],
      "source": "manual"
    }
  ],
  "labellerId": "user_123",
  "meta": {
    "status": "in_progress",
    "tags": ["daytime"]
  }
}
```

**Response (200):**
```json
{
  "imageId": "img_xyz789"
}
```

---

### Get Image File

Downloads the raw image file.

```
GET /api/projects/:projectId/images/:imageId/file
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |
| `imageId` | string | Image identifier |

**Response (200):**
```
Content-Type: image/png | image/jpeg
Body: <raw binary bytes>
```

**Usage in HTML:**
```html
<img src="/api/projects/proj_abc123/images/img_xyz789/file" />
```

---

### Bulk Get Image Metadata

Retrieves metadata for multiple images with filtering and pagination.

```
GET /api/projects/:projectId/images
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | string | No | Comma-separated image IDs |
| `videoId` | string | No | Filter by parent video |
| `status` | string | No | Filter by status |
| `labellerId` | string | No | Filter by labeller |
| `limit` | number | No | Max results (default: 50) |
| `cursor` | string | No | Pagination cursor |

**Example Requests:**
```
GET /api/projects/proj_abc/images?status=unlabeled&limit=20
GET /api/projects/proj_abc/images?videoId=vid_001
GET /api/projects/proj_abc/images?ids=img_001,img_002,img_003
```

**Response (200):**
```json
{
  "items": [
    {
      "imageId": "img_001",
      "videoId": "vid_001",
      "masks": [],
      "labellerId": null,
      "meta": {
        "fileName": "frame_001.png",
        "width": 1920,
        "height": 1080,
        "status": "unlabeled",
        "tags": []
      }
    },
    {
      "imageId": "img_002",
      "videoId": "vid_001",
      "masks": [...],
      "labellerId": "user_123",
      "meta": {
        "fileName": "frame_002.png",
        "width": 1920,
        "height": 1080,
        "status": "labeled",
        "tags": []
      }
    }
  ],
  "cursor": "img_002",
  "total": 150
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | Array of image metadata objects |
| `cursor` | string \| null | Cursor for next page, null if no more |
| `total` | number | Optional total count |

---

### Get Available Images (Unlocked)

Returns unlocked images for labeling, optionally with signed file URLs.

```
GET /api/projects/:projectId/images/available
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|----------|------|----------|-------------|
| `limit` | number | No | Max results (default: 5, max: 50) |
| `status` | string | No | Filter by status |
| `includeFileUrl` | string | No | Use `1` to include signed file URLs |

**Response (200):**
```json
{
  "items": [
    {
      "imageId": "img_001",
      "videoId": "vid_001",
      "masks": [],
      "labellerId": null,
      "meta": {
        "fileName": "frame_001.png",
        "width": 1920,
        "height": 1080,
        "status": "unlabeled",
        "tags": []
      },
      "fileUrl": "https://storage.googleapis.com/..."
    }
  ]
}
```

---

### Delete Image

Deletes an image and its associated file.

```
DELETE /api/projects/:projectId/images/:imageId
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |
| `imageId` | string | Image identifier |

**Response (200):**
```json
{
  "success": true,
  "deletedId": "img_xyz789"
}
```

---

## Locks

Locks prevent concurrent editing of images by multiple users.

### Acquire Locks (Bulk)

Acquires locks on one or more images.

```
POST /api/projects/:projectId/locks
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |

**Request Body:**
```json
{
  "imageIds": ["img_001", "img_002", "img_003"],
  "userId": "user_123",
  "durationMs": 1800000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imageIds` | array | Yes | Array of image IDs to lock |
| `userId` | string | Yes | User requesting the lock |
| `durationMs` | number | No | Lock duration in ms (default: 30 min) |

**Response (200):**
```json
{
  "results": [
    {
      "imageId": "img_001",
      "locked": true,
      "lockedBy": "user_123",
      "expiresAt": "2024-01-15T10:30:00Z"
    },
    {
      "imageId": "img_002",
      "locked": true,
      "lockedBy": "user_123",
      "expiresAt": "2024-01-15T10:30:00Z"
    },
    {
      "imageId": "img_003",
      "locked": false,
      "lockedBy": "user_456",
      "expiresAt": "2024-01-15T10:15:00Z",
      "error": "ALREADY_LOCKED"
    }
  ]
}
```

**Lock Logic:**
- Lock succeeds if image is unlocked, lock expired, or same user refreshing
- Lock fails if locked by different user and not expired
- Expired locks are automatically considered released

---

### Release Locks (Bulk)

Releases locks on one or more images.

```
DELETE /api/projects/:projectId/locks
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier |

**Request Body:**
```json
{
  "imageIds": ["img_001", "img_002"],
  "userId": "user_123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `imageIds` | array | Yes | Array of image IDs to unlock |
| `userId` | string | Yes | User releasing the lock |

**Response (200):**
```json
{
  "results": [
    {
      "imageId": "img_001",
      "released": true
    },
    {
      "imageId": "img_002",
      "released": true
    }
  ]
}
```

**Note:** Release only works if the lock is held by the requesting user.

---

## Segmentation (SAM3)

AI-powered image segmentation using Segment Anything Model 3.
Rate limit: 10 requests/minute per user.

### Run Segmentation

```
POST /api/segment
```

**Request Body (SAM3 direct):**
```json
{
  "type": "start_session",
  "resourceUrl": "https://storage.googleapis.com/...",
  "projectId": "proj_abc123",
  "imageId": "img_xyz789"
}
```

Use the SAM3 request format (`start_session`, `add_prompt`, `propagate_in_video`, `close_session`). The backend forwards the payload to the in-container SAM3 server. If `resourceUrl` is omitted and `projectId + imageId` is provided, the backend signs the image URL from storage for `start_session`.

**Example: Add prompt**
```json
{
  "type": "add_prompt",
  "session_id": "session_123",
  "frame_index": 0,
  "text": "the red car"
}
```

**Example: Propagate**
```json
{
  "type": "propagate_in_video",
  "session_id": "session_123"
}
```

**Legacy Request Body (torchscript-only):**
```json
{
  "mode": "click",
  "image": "<data-uri-or-raw-base64>",
  "points": [
    {"x": 500, "y": 300, "label": 1},
    {"x": 100, "y": 100, "label": 0}
  ]
}
```
The legacy `mode` payload is supported only when the SAM handler is set to `torchscript`.

**Response (200):**
```json
{
  "masks": [
    {
      "polygon": [
        [
          {"x": 150.5, "y": 100.2},
          {"x": 250.3, "y": 100.5},
          {"x": 250.1, "y": 200.8},
          {"x": 150.2, "y": 200.3}
        ]
      ],
      "boundingBox": {
        "x": 150,
        "y": 100,
        "w": 100,
        "h": 100
      },
      "area": 10000,
      "score": 0.95
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `polygon` | array | Array of rings (first = outer, rest = holes) |
| `boundingBox` | object | Bounding box of the mask |
| `area` | number | Mask area in pixels |
| `score` | number | Confidence score (0-1) |

---

## Data Types

### Mask

```json
{
  "id": "mask_001",
  "classId": "cls_001",
  "className": "Person",
  "color": "#FF0000",
  "polygon": [
    [
      {"x": 100, "y": 100},
      {"x": 200, "y": 100},
      {"x": 200, "y": 200},
      {"x": 100, "y": 200}
    ]
  ],
  "source": "sam3_click"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique mask identifier |
| `classId` | string | Reference to label class |
| `className` | string | Display name of class |
| `color` | string | Hex color for rendering |
| `polygon` | array | Array of rings (outer + holes) |
| `source` | string | How mask was created |

**Source Values:**
- `sam3_click` - Created via click-based SAM3
- `sam3_auto` - Created via auto-segment SAM3
- `sam3_semantic` - Created via semantic SAM3
- `manual` - Manually drawn polygon

### Point

```json
{
  "x": 150.5,
  "y": 200.3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `x` | number | X coordinate (image pixels) |
| `y` | number | Y coordinate (image pixels) |

### Image Status

| Value | Description |
|-------|-------------|
| `unlabeled` | No annotations yet |
| `in_progress` | Currently being labeled |
| `labeled` | Labeling complete |

---

## Error Responses

All errors follow this format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | User lacks permission |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `CONFLICT` | 409 | Resource conflict (e.g., lock) |
| `INTERNAL_ERROR` | 500 | Server error |

### Examples

**404 Not Found:**
```json
{
  "error": "NOT_FOUND",
  "message": "Image not found: img_xyz789"
}
```

**400 Validation Error:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "meta.fileName is required"
}
```

**409 Lock Conflict:**
```json
{
  "error": "ALREADY_LOCKED",
  "message": "Image is locked by another user"
}
```

---

## API Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/:projectId` | Get project |
| `POST` | `/api/projects/:projectId/images` | Upload image package |
| `GET` | `/api/projects/:projectId/images` | Bulk get metadata |
| `GET` | `/api/projects/:projectId/images/available` | List unlocked images |
| `GET` | `/api/projects/:projectId/images/:imageId` | Get single metadata |
| `GET` | `/api/projects/:projectId/images/:imageId/file` | Get raw image file |
| `DELETE` | `/api/projects/:projectId/images/:imageId` | Delete image |
| `POST` | `/api/projects/:projectId/locks` | Acquire locks |
| `DELETE` | `/api/projects/:projectId/locks` | Release locks |
| `POST` | `/api/segment` | Run SAM3 segmentation |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| All endpoints | 100 requests/minute per user |
| Image upload | 50 MB max file size |
| Bulk get | 500 images max per request |

---

*Document generated for RoCam Labeler v1.0*
