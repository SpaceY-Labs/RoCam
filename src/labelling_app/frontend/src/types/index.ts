// Core domain types for the labelling app

export interface LabelClass {
  id: string;
  name: string;
  color: string;
}

export interface Project {
  projectId: string;
  name: string;
  description: string | null;
  classes: LabelClass[];
  createdAt: string;
  imageCount?: number;
  labeledCount?: number;
  unlabeledCount?: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[][];

export type MaskSource = 'sam3_click' | 'sam3_auto' | 'sam3_semantic' | 'manual';

export interface ImageMask {
  id: string;
  classId: string;
  className: string;
  color: string;
  polygon: Polygon;
  source: MaskSource;
}

export interface SegmentMask {
  polygon: Polygon;
  boundingBox: { x: number; y: number; w: number; h: number };
  area: number;
  score: number;
}

export interface SegmentResponse {
  masks: SegmentMask[];
}

export interface ImageMeta {
  fileName: string;
  width: number;
  height: number;
  status: ImageStatus;
  tags: string[];
}

export type ImageStatus = 'unlabeled' | 'in_progress' | 'labeled';

export interface ProjectImage {
  imageId: string;
  projectId: string;
  meta: ImageMeta;
  fileUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  masks?: ImageMask[];
}

export interface BoundingBox {
  id: string;
  classId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source?: MaskSource;
}

export interface ImageAnnotation {
  imageId: string;
  boxes: BoundingBox[];
  updatedAt: string;
}

// UI State types
export type RouteId = 'projects' | 'create' | 'label' | 'upload';

export interface NavItem {
  id: RouteId;
  label: string;
  description: string;
  icon: string;
}

export interface PageMeta {
  eyebrow: string;
  title: string;
  subtitle: string;
}

// Form types
export interface ProjectFormData {
  name: string;
  description: string;
  classes: LabelClass[];
}

export interface UploadFormData {
  file: File | null;
  width: number;
  height: number;
  status: ImageStatus;
  tags: string;
}

// Component prop types
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

// API DTOs
export interface ProjectApiItem {
  projectId: string;
  name: string;
  description?: string | null;
  classes?: LabelClass[];
  createdAt?: string;
  imageCount?: number;
  labeledCount?: number;
}

export interface ProjectsApiResponse {
  items: ProjectApiItem[];
}

export interface ProjectImageMetaApi {
  fileName?: string;
  width?: number;
  height?: number;
  status?: ImageStatus;
  tags?: string[];
}

export interface ProjectImageApiItem {
  imageId: string;
  projectId?: string;
  meta?: ProjectImageMetaApi;
  fileUrl?: string;
  createdAt?: string;
  masks?: ImageMask[];
}

export interface ProjectImagesApiResponse {
  items: ProjectImageApiItem[];
  cursor?: string | null;
  total?: number;
}

export interface LockResult {
  imageId: string;
  locked: boolean;
}

export interface LockResponse {
  results: LockResult[];
}

export interface UploadImageResponse {
  imageId: string;
}
