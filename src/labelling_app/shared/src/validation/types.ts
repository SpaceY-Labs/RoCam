export type ProjectClass = {
  id: string;
  name: string;
  color: string;
};

export type Project = {
  projectId: string;
  name: string;
  description: string | null;
  classes: ProjectClass[];
};

export type Point = {
  x: number;
  y: number;
};

export type PointWithLabel = Point & {
  label: 0 | 1;
};

export type MaskValue = 0 | 1 | boolean;

export type MaskTensor = MaskValue[][];

export type Mask = {
  id: string;
  classId: string;
  className: string;
  color: string;
  mask?: MaskTensor;
  boundingBox?: BoundingBox;
  source: "sam2_click" | "sam2_auto" | "sam2_semantic" | "manual";
};

export type ImageMeta = {
  fileName: string;
  width: number;
  height: number;
  status: "unlabeled" | "in_progress" | "labeled";
  tags?: string[];
};

export type ImageRecord = {
  imageId: string;
  videoId: string | null;
  masks: Mask[];
  labellerId: string | null;
  meta: ImageMeta;
};

export type ImageUpdateRequest = {
  videoId?: string | null;
  masks?: Mask[];
  labellerId?: string | null;
  meta?: Partial<ImageMeta>;
};

export type BoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LockAcquireRequest = {
  imageIds: string[];
  userId: string;
  durationMs?: number;
};

export type LockReleaseRequest = {
  imageIds: string[];
  userId: string;
};

export type LockResult = {
  imageId: string;
  locked?: boolean;
  released?: boolean;
  lockedBy?: string | null;
  expiresAt?: string | null;
  error?: string;
};
