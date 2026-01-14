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

export type Polygon = Point[][];

export type Mask = {
  id: string;
  classId: string;
  className: string;
  color: string;
  polygon: Polygon;
  source: "sam3_click" | "sam3_auto" | "sam3_semantic" | "manual";
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

export type SegmentLegacyRequest = {
  projectId?: string;
  imageId?: string;
  imageUrl?: string;
  image?: string;
  imageBase64?: string;
  mode: "click" | "auto" | "semantic";
  points?: PointWithLabel[];
  box?: { x1: number; y1: number; x2: number; y2: number };
  prompt?: string;
};

export type SegmentSam3Request = {
  type: string;
  projectId?: string;
  imageId?: string;
  resourceUrl?: string;
  resource_url?: string;
  resourcePath?: string;
  resource_path?: string;
  [key: string]: unknown;
};

export type SegmentRequest = SegmentLegacyRequest | SegmentSam3Request;

export type SegmentMask = {
  polygon: Polygon;
  boundingBox: BoundingBox;
  area: number;
  score: number;
};

export type SegmentResponse = {
  masks: SegmentMask[];
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
