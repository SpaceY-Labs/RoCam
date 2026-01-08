import { getSignedUrl } from '../storage/storage.service.js';

export async function getDownloadUrl(path: string, expiresMs?: number): Promise<string> {
  return getSignedUrl(path, 'read', expiresMs);
}




