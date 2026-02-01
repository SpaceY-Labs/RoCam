/**
 * ImageUpload - Image upload page
 * Handles ZIP file upload with metadata configuration
 */

import { useState, useRef } from 'react';
import type { ImageStatus, Project } from '../../types';
import { Button, Select, Card, EmptyState } from '../../components/ui';
import { downloadProjectZip } from '../../modules/API_Helps';
import { DropZone, type UploadFile } from './components/DropZone';
import { FileInfo } from './components/FileInfo';
import { TagManager } from './components/TagManager';
import { UploadTips } from './components/UploadTips';
import { FolderIcon } from './components/FolderIcon';
import './ImageUpload.css';

// ============ Constants ============
const STATUS_OPTIONS = [
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'labeled', label: 'Labeled' },
];

// ============ Types ============
export interface ImageUploadProps {
  /** Current project */
  project: Project | null;
  /** Callback when upload is triggered */
  onUpload: (file: File, meta: { status: ImageStatus; tags: string[] }) => void;
  /** Callback when user wants to select a project */
  onSelectProject: () => void;
  /** Whether upload is in progress */
  loading?: boolean;
}

// ============ Component ============
export function ImageUpload({
  project,
  onUpload,
  onSelectProject,
  loading = false,
}: ImageUploadProps) {
  // ============ State ============
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [status, setStatus] = useState<ImageStatus>('unlabeled');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============ Handlers ============

  /**
   * Handle file selection
   */
  const handleFileSelect = (file: File) => {
    setUploadFile({ file, kind: 'zip' });
  };

  /**
   * Clear selected file
   */
  const handleClear = () => {
    setUploadFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Add a tag
   */
  const handleAddTag = () => {
    const trimmedTag = tagInput.trim().toLowerCase();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  /**
   * Remove a tag
   */
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  /**
   * Handle upload
   */
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

  const handleDownloadZip = async () => {
    if (!project?.projectId) return;
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      await downloadProjectZip(project.projectId, { limit: 100 });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadLoading(false);
    }
  };

  // ============ Empty State ============
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

  // ============ Render ============
  return (
    <div className="upload-container">
      <div className="upload-grid">
        {/* Left: Drop Zone */}
        <div className="upload-dropzone-section">
          <DropZone
            uploadFile={uploadFile}
            onFileSelect={handleFileSelect}
            onClear={handleClear}
          />

          {uploadFile && (
            <FileInfo
              fileName={uploadFile.file.name}
              fileSize={uploadFile.file.size}
              fileType="ZIP archive"
            />
          )}
        </div>

        {/* Right: Metadata Form */}
        <div className="upload-form-section">
          <Card variant="elevated" padding="medium">
            <h3 className="form-title">Upload Metadata</h3>
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

              <TagManager
                tags={tags}
                tagInput={tagInput}
                onInputChange={setTagInput}
                onAddTag={handleAddTag}
                onRemoveTag={handleRemoveTag}
              />
            </div>

            <div className="upload-actions">
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={!uploadFile}
                loading={loading}
              >
                Upload ZIP
              </Button>
              <Button
                variant="secondary"
                onClick={handleDownloadZip}
                disabled={downloadLoading}
                loading={downloadLoading}
              >
                Download ZIP
              </Button>
            </div>
            {downloadError && (
              <p className="upload-error" role="alert">
                {downloadError}
              </p>
            )}
          </Card>

          <UploadTips />
        </div>
      </div>
    </div>
  );
}

export default ImageUpload;
