import type { Timestamp } from 'firebase/firestore';

/**
 * Mask entity representing a single segmentation annotation
 */
export interface Mask {
  id: string;
  classId: string;
  data: MaskData;
  boundingBox: BoundingBox;
  area: number; // Pixel count
  source: MaskSource;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Mask geometry data (polygon format)
 */
export interface MaskData {
  type: 'polygon';
  polygon: Point[][]; // Outer boundary + holes
}

/**
 * 2D point coordinate
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Bounding box for spatial queries
 */
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Source of mask creation
 */
export type MaskSource = 'sam3_auto' | 'sam3_click' | 'sam3_semantic' | 'manual';

/**
 * Mask creation payload
 */
export interface CreateMaskInput {
  classId: string;
  data: MaskData;
  boundingBox: BoundingBox;
  area: number;
  source: MaskSource;
}

/**
 * Bulk mask save payload (replaces all masks for an image)
 */
export interface SaveMasksInput {
  masks: CreateMaskInput[];
}
