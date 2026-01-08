import type { Timestamp } from 'firebase/firestore';
import type { ImageStatus } from './image';
/**
 * Supported export formats
 */
export type ExportFormat = 'coco_json' | 'raw_masks' | 'yolo' | 'pascal_voc';
/**
 * Export job entity
 */
export interface ExportJob {
    id: string;
    projectId: string;
    format: ExportFormat;
    status: ExportStatus;
    progress: number;
    filters: ExportFilters;
    outputPath: string | null;
    downloadUrl: string | null;
    expiresAt: Timestamp | null;
    error: string | null;
    createdBy: string;
    createdAt: Timestamp;
    completedAt: Timestamp | null;
}
/**
 * Export job status
 */
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed';
/**
 * Export filters to select which images to export
 */
export interface ExportFilters {
    status?: ImageStatus[];
    assignedTo?: string;
    labeledBy?: string;
    classIds?: string[];
}
/**
 * Start export request
 */
export interface StartExportInput {
    format: ExportFormat;
    filters?: ExportFilters;
}
//# sourceMappingURL=export.d.ts.map