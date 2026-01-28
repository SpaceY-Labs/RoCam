/**
 * FileInfo - Display file metadata
 * Shows file name, size, and type
 */

// ============ Types ============
export interface FileInfoProps {
  /** File name */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** File type description */
  fileType: string;
}

// ============ Helpers ============

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============ Component ============
export function FileInfo({ fileName, fileSize, fileType }: FileInfoProps) {
  return (
    <div className="file-info">
      <div className="file-info-item">
        <span className="file-info-label">File</span>
        <span className="file-info-value">{fileName}</span>
      </div>
      <div className="file-info-item">
        <span className="file-info-label">Size</span>
        <span className="file-info-value">{formatFileSize(fileSize)}</span>
      </div>
      <div className="file-info-item">
        <span className="file-info-label">Type</span>
        <span className="file-info-value">{fileType}</span>
      </div>
    </div>
  );
}

export default FileInfo;
