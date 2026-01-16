import { useState, useRef, useCallback } from 'react';
import type { ImageStatus, Project } from '../types';
import { Button, Select, Input, Card, EmptyState, TagBadge } from './ui';

interface ImageUploadProps {
  project: Project | null;
  onUpload: (file: File, meta: { status: ImageStatus; tags: string[] }) => void;
  onSelectProject: () => void;
  loading?: boolean;
}

interface UploadFile {
  file: File;
  preview: string;
  dimensions: { width: number; height: number } | null;
}

const STATUS_OPTIONS = [
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'labeled', label: 'Labeled' },
];

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

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
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

    setUploadFile({ file, preview, dimensions });
  }, []);

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
    onUpload(uploadFile.file, { status, tags });

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
    setUploadFile(null);
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
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden-input"
              />

              {uploadFile ? (
                <div className="upload-preview">
                  <img src={uploadFile.preview} alt="Preview" />
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
                  <span className="dropzone-hint">Supports JPG, PNG, WebP</span>
                </div>
              )}
            </div>
          </Card>

          {uploadFile?.dimensions && (
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
                  {uploadFile.dimensions.width} x {uploadFile.dimensions.height}
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
