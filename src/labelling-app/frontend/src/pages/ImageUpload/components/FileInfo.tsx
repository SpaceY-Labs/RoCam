/**
 * FileInfo - Display file metadata
 * Shows file name, size, and type
 */

import type { FileInfoProps } from './fileInfoUtils';
import { formatFileSize } from './fileInfoUtils';

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
