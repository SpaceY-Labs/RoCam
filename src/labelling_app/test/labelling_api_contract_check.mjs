const API_BASE_URL = process.env.API_BASE_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;
const IMAGE_ID = process.env.IMAGE_ID;
const EXPORT_ID = process.env.EXPORT_ID;
const USER_ID = process.env.USER_ID;
const CLASS_ID = process.env.CLASS_ID;

if (!API_BASE_URL) {
  console.error('Missing API_BASE_URL (e.g. https://example.run.app)');
  process.exit(1);
}

if (!AUTH_TOKEN) {
  console.error('Missing AUTH_TOKEN (Firebase ID token).');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

const tests = [
  { name: 'health', method: 'GET', path: '/health', auth: false },
  { name: 'auth sync', method: 'POST', path: '/auth/sync', auth: false, body: {} },
  { name: 'auth profile', method: 'GET', path: '/auth/profile', auth: false },
  { name: 'projects list', method: 'GET', path: '/projects' },
  { name: 'projects create', method: 'POST', path: '/projects', body: { name: 'Test Project' } },
  {
    name: 'project get',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'project update',
    method: 'PATCH',
    path: `/projects/${PROJECT_ID || ''}`,
    body: { name: 'Updated Project' },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'project stats',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/stats`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'members list',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/members`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'members invite',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/members`,
    body: { email: 'test@example.com', role: 'labeler' },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'members update',
    method: 'PATCH',
    path: `/projects/${PROJECT_ID || ''}/members/${USER_ID || ''}`,
    body: { role: 'admin' },
    requires: ['PROJECT_ID', 'USER_ID'],
  },
  {
    name: 'classes list',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/classes`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'classes create',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/classes`,
    body: { name: 'Label', color: '#00FF00' },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'classes update',
    method: 'PATCH',
    path: `/projects/${PROJECT_ID || ''}/classes/${CLASS_ID || ''}`,
    body: { name: 'Label Updated', color: '#FF0000' },
    requires: ['PROJECT_ID', 'CLASS_ID'],
  },
  {
    name: 'classes reorder',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/classes/reorder`,
    body: { classIds: CLASS_ID ? [CLASS_ID] : ['class-id'] },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'images list',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/images`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'images upload urls',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/images/upload-urls`,
    body: {
      files: [{ fileName: 'test.png', contentType: 'image/png', size: 1024 }],
    },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'images confirm upload',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/images/confirm-upload`,
    body: { imageIds: ['image-id'] },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'images get',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/images/${IMAGE_ID || ''}`,
    requires: ['PROJECT_ID', 'IMAGE_ID'],
  },
  {
    name: 'images bulk delete',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/images/bulk-delete`,
    body: { imageIds: ['image-id'] },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'assignment assign',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/assign`,
    body: { strategy: 'count', count: 1, assignTo: null },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'assignment queue',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/my-queue`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'assignment release',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/release`,
    body: {},
    requires: ['PROJECT_ID'],
  },
  {
    name: 'assignment refresh',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/refresh-locks`,
    body: {},
    requires: ['PROJECT_ID'],
  },
  {
    name: 'labeling for-labeling',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/images/${IMAGE_ID || ''}/for-labeling`,
    requires: ['PROJECT_ID', 'IMAGE_ID'],
  },
  {
    name: 'labeling get masks',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/images/${IMAGE_ID || ''}/masks`,
    requires: ['PROJECT_ID', 'IMAGE_ID'],
  },
  {
    name: 'labeling save masks',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/images/${IMAGE_ID || ''}/masks`,
    body: {
      masks: [
        {
          classId: CLASS_ID || 'class-id',
          data: {
            type: 'polygon',
            polygon: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
          },
          boundingBox: { x: 0, y: 0, w: 1, h: 1 },
          area: 1,
          source: 'manual',
        },
      ],
    },
    requires: ['PROJECT_ID', 'IMAGE_ID'],
  },
  {
    name: 'segment click',
    method: 'POST',
    path: '/segment/click',
    body: {
      imageUrl: 'https://example.com/test.png',
      points: [{ x: 10, y: 10 }],
    },
  },
  {
    name: 'segment auto',
    method: 'POST',
    path: '/segment/auto',
    body: { imageUrl: 'https://example.com/test.png' },
  },
  {
    name: 'segment semantic',
    method: 'POST',
    path: '/segment/semantic',
    body: { imageUrl: 'https://example.com/test.png', prompt: 'object' },
  },
  {
    name: 'export start',
    method: 'POST',
    path: `/projects/${PROJECT_ID || ''}/export`,
    body: { format: 'coco_json' },
    requires: ['PROJECT_ID'],
  },
  {
    name: 'export get',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/export/${EXPORT_ID || ''}`,
    requires: ['PROJECT_ID', 'EXPORT_ID'],
  },
  {
    name: 'export list',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/export`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'analytics overview',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/analytics`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'analytics team',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/analytics/team`,
    requires: ['PROJECT_ID'],
  },
  {
    name: 'analytics me',
    method: 'GET',
    path: `/projects/${PROJECT_ID || ''}/analytics/me`,
    requires: ['PROJECT_ID'],
  },
];

const envMap = {
  PROJECT_ID,
  IMAGE_ID,
  EXPORT_ID,
  USER_ID,
  CLASS_ID,
};

const runTest = async (test) => {
  if (test.requires) {
    const missing = test.requires.filter((key) => !envMap[key]);
    if (missing.length) {
      return { skipped: true, reason: `missing ${missing.join(', ')}` };
    }
  }

  const url = `${API_BASE_URL}${test.path}`;
  const options = {
    method: test.method,
    headers: test.auth === false ? { 'Content-Type': 'application/json' } : headers,
  };

  if (test.body) {
    options.body = JSON.stringify(test.body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body: json,
  };
};

let failures = 0;

for (const test of tests) {
  try {
    const result = await runTest(test);
    if (result.skipped) {
      console.log(`SKIP ${test.name} (${result.reason})`);
      continue;
    }

    if (!result.ok) {
      failures += 1;
      console.log(`FAIL ${test.name} (${result.status})`);
    } else {
      console.log(`PASS ${test.name}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${test.name} (error: ${error.message})`);
  }
}

if (failures > 0) {
  process.exit(1);
}
