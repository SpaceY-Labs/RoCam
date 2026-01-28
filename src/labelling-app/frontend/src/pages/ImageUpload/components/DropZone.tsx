/**
 * DropZone - Drag-and-drop file upload area
 * Supports ZIP file upload with drag-and-drop or click to browse
 */

import { useCallback, useRef, useState } from 'react';
import { Card } from '../../../components/ui';

// ============ Types ============
export interface UploadFile {
  file: File;
  kind: 'zip';
}

export interface DropZoneProps {
  /** Currently selected file */
  uploadFile: UploadFile | null;
  /** Callback when file is selected */
  onFileSelect: (file: File) => void;
  /** Callback when file is cleared */
  onClear: () => void;
}

// ============ Icons ============
function UploadIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ============ Component ============
export function DropZone({ uploadFile, onFileSelect, onClear }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============ Helpers ============

  /**
   * Check if file is a ZIP file
   */
  const isZipFile = (file: File): boolean => {
    return file.type.includes('zip') || file.name.toLowerCase().endsWith('.zip');
  };

  /**
   * Process selected file
   */
  const processFile = useCallback(
    (file: File) => {
      if (!isZipFile(file)) {
        alert('Please select a ZIP file');
        return;
      }
      onFileSelect(file);
    },
    [onFileSelect]
  );

  // ============ Event Handlers ============

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  };

  const handleClear = () => {
    onClear();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (!uploadFile) {
      fileInputRef.current?.click();
    }
  };

  // ============ Render ============
  return (
    <Card variant="bordered" padding="none">
      <div
        className={`upload-dropzone ${isDragging ? 'dragging' : ''} ${uploadFile ? 'has-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={handleFileSelect}
          className="hidden-input"
        />

        {uploadFile ? (
          <div className="upload-preview">
            <div className="dropzone-content">
              <div className="dropzone-icon">
                <ZipIcon />
              </div>
              <h3>ZIP archive selected</h3>
              <p>{uploadFile.file.name}</p>
            </div>
            <button className="preview-clear" onClick={handleClear} aria-label="Clear">
              <ClearIcon />
            </button>
          </div>
        ) : (
          <div className="dropzone-content">
            <div className="dropzone-icon">
              <UploadIcon />
            </div>
            <h3>Drop ZIP file here</h3>
            <p>or click to browse</p>
            <span className="dropzone-hint">Supports ZIP archives containing images</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export default DropZone;
