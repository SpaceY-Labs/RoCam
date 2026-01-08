import { config } from '../../config/server.js';
import { getSignedUrl } from '../storage/storage.service.js';
import { Point, BoundingBox } from 'shared';

interface SegmentationResult {
  polygon: Point[][];
  boundingBox: BoundingBox;
  area: number;
  score: number;
}

async function resolveImageUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith('http')) {
    return imageUrl;
  }

  return getSignedUrl(imageUrl, 'read', 15 * 60 * 1000);
}

async function callSAM3<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.sam3ServiceUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SAM3 error: ${error}`);
  }

  return response.json() as Promise<T>;
}

export async function clickSegment(
  imageUrl: string,
  points: Array<{ x: number; y: number; label: 0 | 1 }>,
  box?: { x1: number; y1: number; x2: number; y2: number }
): Promise<SegmentationResult> {
  const resolvedUrl = await resolveImageUrl(imageUrl);

  return callSAM3('/segment/click', {
    image_url: resolvedUrl,
    points,
    box,
  });
}

export async function autoSegment(
  imageUrl: string
): Promise<SegmentationResult[]> {
  const resolvedUrl = await resolveImageUrl(imageUrl);

  const response = await callSAM3<{ segments: SegmentationResult[] }>(
    '/segment/auto',
    { image_url: resolvedUrl }
  );

  return response.segments;
}

export async function semanticSegment(
  imageUrl: string,
  prompt: string
): Promise<SegmentationResult> {
  const resolvedUrl = await resolveImageUrl(imageUrl);

  return callSAM3('/segment/semantic', {
    image_url: resolvedUrl,
    prompt,
  });
}







