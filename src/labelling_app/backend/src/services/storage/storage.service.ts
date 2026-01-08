import { storage } from '../../config/firebase.js';

export async function getSignedUrl(
  path: string,
  action: 'read' | 'write',
  expiresMs = 15 * 60 * 1000
): Promise<string> {
  const [url] = await storage
    .bucket()
    .file(path)
    .getSignedUrl({
      action,
      expires: Date.now() + expiresMs,
    });

  return url;
}




