import { useState, useRef, useEffect, useCallback } from 'react';
import type { ImageStatus, Project } from '../types';
import { Button, Select, Input, Card, EmptyState, TagBadge } from './ui';

interface ImageUploadProps {
  project: Project | null;
  onUpload: (file: File, meta: { status: ImageStatus; tags: string[] }, uploadId: string) => void;
  onSelectProject: () => void;
  loading?: boolean;
}

interface UploadFile {
  file: File;
  preview?: string;
  dimensions: { width: number; height: number } | null;
  kind: 'image' | 'zip';
}

const STATUS_OPTIONS = [
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'labeled', label: 'Labeled' },
];

const MAX_WS_RETRIES = 3;

const buildProgressWsUrl = (uploadId: string) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    return null;
  }
  try {
    const url = new URL('/api/progress', apiBase);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (uploadId) {
      url.searchParams.set('uploadId', uploadId);
    }
    return url.toString();
  } catch {
    return null;
  }
};

export function ImageUpload({
  project,
  onUpload,
  onSelectProject,
  loading = false,
}: ImageUploadProps) {
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [status, setStatus] = useState<ImageStatus>('unlabeled');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const uploadIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    status: 'idle' | 'running' | 'done' | 'error';
    error?: string;
  }>({ completed: 0, total: 0, status: 'idle' });

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connectWebSocket = (uploadId: string) => {
    const wsUrl = buildProgressWsUrl(uploadId);
    if (!wsUrl) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptsRef.current = 0;
      socket.send(JSON.stringify({ type: 'subscribe', uploadId }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        if (
          message?.type === 'progress' &&
          message.uploadId &&
          message.uploadId === uploadIdRef.current
        ) {
          setUploadProgress({
            completed: Number(message.completed) || 0,
            total: Number(message.total) || 0,
            status: message.status || 'running',
            error: message.error,
          });
          if (message.status === 'done' || message.status === 'error') {
            uploadInFlightRef.current = false;
            clearReconnectTimer();
            socket.close();
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    socket.onclose = () => {
      wsRef.current = null;
      if (!uploadInFlightRef.current) {
        return;
      }
      if (reconnectAttemptsRef.current >= MAX_WS_RETRIES) {
        return;
      }
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(1000 * 2 ** (reconnectAttemptsRef.current - 1), 8000);
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        const currentUpload = uploadIdRef.current;
        if (currentUpload) {
          connectWebSocket(currentUpload);
        }
      }, delay);
    };
  };

  useEffect(() => {
    return () => {
      uploadInFlightRef.current = false;
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const isZipFile = (file: File) =>
    file.type.includes('zip') || file.name.toLowerCase().endsWith('.zip');

  const processFile = useCallback(async (file: File) => {
    const isZip = isZipFile(file);
    if (!file.type.startsWith('image/') && !isZip) {
      alert('Please select an image or zip file');
      return;
    }

    if (isZip) {
      setUploadFile({ file, dimensions: null, kind: 'zip' });
      return;
    }

    const preview = URL.createObjectURL(file);

    // Get image dimensions
    const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
      };
      img.src = preview;
    });

    setUploadFile({ file, preview, dimensions, kind: 'image' });
  }, [isZipFile]);

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

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim().toLowerCase();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleUpload = () => {
    if (!uploadFile) return;
    const uploadId = crypto.randomUUID();
    uploadIdRef.current = uploadId;
    setUploadProgress({ completed: 0, total: 0, status: 'running' });
    uploadInFlightRef.current = true;
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    wsRef.current?.close();
    connectWebSocket(uploadId);
    onUpload(uploadFile.file, { status, tags }, uploadId);

    // Reset form
    setUploadFile(null);
    setStatus('unlabeled');
    setTags([]);
    setTagInput('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClear = () => {
    if (uploadFile?.preview) {
      URL.revokeObjectURL(uploadFile.preview);
    }
    uploadInFlightRef.current = false;
    clearReconnectTimer();
    wsRef.current?.close();
    wsRef.current = null;
    setUploadFile(null);
    setUploadProgress({ completed: 0, total: 0, status: 'idle' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!project) {
    return (
      <div className="upload-container">
        <EmptyState
          icon={<FolderIcon />}
          title="No project selected"
          description="Select a project before uploading images."
          action={{ label: 'Go to Projects', onClick: onSelectProject }}
        />
      </div>
    );
  }

  return (
    <div className="upload-container">
      <div className="upload-grid">
        {/* Left: Drop Zone */}
        <div className="upload-dropzone-section">
          <Card variant="bordered" padding="none">
            <div
              className={`upload-dropzone ${isDragging ? 'dragging' : ''} ${uploadFile ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !uploadFile && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.zip,application/zip"
                onChange={handleFileSelect}
                className="hidden-input"
              />

              {uploadFile ? (
                <div className="upload-preview">
                  {uploadFile.kind === 'image' && uploadFile.preview ? (
                    <img src={uploadFile.preview} alt="Preview" />
                  ) : (
                    <div className="dropzone-content">
                      <div className="dropzone-icon">
                        <UploadIcon />
                      </div>
                      <h3>Zip archive selected</h3>
                      <p>{uploadFile.file.name}</p>
                    </div>
                  )}
                  <button className="preview-clear" onClick={handleClear} aria-label="Clear">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="dropzone-content">
                  <div className="dropzone-icon">
                    <UploadIcon />
                  </div>
                  <h3>Drop image here</h3>
                  <p>or click to browse</p>
                  <span className="dropzone-hint">Supports JPG, PNG, WebP, ZIP</span>
                </div>
              )}
            </div>
          </Card>

          {uploadFile && (
            <div className="file-info">
              <div className="file-info-item">
                <span className="file-info-label">File</span>
                <span className="file-info-value">{uploadFile.file.name}</span>
              </div>
              <div className="file-info-item">
                <span className="file-info-label">Size</span>
                <span className="file-info-value">
                  {formatFileSize(uploadFile.file.size)}
                </span>
              </div>
              <div className="file-info-item">
                <span className="file-info-label">Dimensions</span>
                <span className="file-info-value">
                  {uploadFile.kind === 'zip'
                    ? 'Zip archive'
                    : `${uploadFile.dimensions?.width || 0} x ${uploadFile.dimensions?.height || 0}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Metadata Form */}
        <div className="upload-form-section">
          <Card variant="elevated" padding="medium">
            <h3 className="form-title">Image Metadata</h3>
            <p className="form-subtitle">
              Uploading to: <strong>{project.name}</strong>
            </p>

            <div className="upload-form-fields">
              <Select
                label="Initial Status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setStatus(e.target.value as ImageStatus)}
              />

              <div className="tags-input-group">
                <label>Tags</label>
                <div className="tags-input-row">
                  <Input
                    placeholder="Add a tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                  >
                    Add
                  </Button>
                </div>
                {tags.length > 0 && (
                  <div className="tags-list">
                    {tags.map(tag => (
                      <TagBadge
                        key={tag}
                        tag={tag}
                        onRemove={() => handleRemoveTag(tag)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="upload-actions">
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={!uploadFile}
                loading={loading}
              >
                Upload Image
              </Button>
              {uploadProgress.status !== 'idle' && (
                <div
                  className={
                    uploadProgress.status === 'error' ? 'upload-progress error' : 'upload-progress'
                  }
                >
                  <span>
                    {uploadProgress.status === 'error'
                      ? 'Segmentation failed'
                      : `Segmentation ${uploadProgress.completed}/${uploadProgress.total || '?'}`}
                  </span>
                  {uploadProgress.error && <span>{uploadProgress.error}</span>}
                </div>
              )}
            </div>
          </Card>

          <Card variant="bordered" padding="small" className="upload-tips">
            <h4>Tips</h4>
            <ul>
              <li>Use descriptive tags to organize your images</li>
              <li>Set status to "unlabeled" for new images</li>
              <li>Batch uploads coming soon!</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}
