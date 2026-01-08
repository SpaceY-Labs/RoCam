export const config = {
  port: Number.parseInt(process.env.PORT || '8080', 10),
  projectId: process.env.PROJECT_ID || '',
  region: process.env.REGION || 'us-central1',
  sam3ServiceUrl: process.env.SAM3_SERVICE_URL || 'http://localhost:8081',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};
