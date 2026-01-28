import { useState, type ChangeEvent } from 'react';
import { uploadZipToBackend } from './API_Helps';

type ZipUploadButtonProps = {
  projectId: string;
  status?: 'unlabeled' | 'in_progress' | 'labeled';
  tags?: string[];
  onUploadComplete?: (result: { imageIds: string[]; count: number; masksCount: number }) => void;
};

const ZipUploadButton = ({ projectId, status = 'unlabeled', tags = [], onUploadComplete }: ZipUploadButtonProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imageIds: string[]; count: number; masksCount: number } | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const selectedFile = e.target.files[0];
      if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
        alert('Please select a ZIP file');
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a ZIP file first!");

    setUploading(true);
    try {
      const uploadResult = await uploadZipToBackend(projectId, file, {
        status,
        tags,
      });

      setResult(uploadResult);
      onUploadComplete?.(uploadResult);
      alert(`Upload successful! ${uploadResult.count} images uploaded, ${uploadResult.masksCount} with masks.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to upload: ${message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <input
        type="file"
        onChange={handleFileChange}
        accept=".zip,application/zip"
      />

      <button
        onClick={handleUpload}
        disabled={uploading || !file}
        style={{ marginLeft: '10px', cursor: uploading ? 'not-allowed' : 'pointer' }}
      >
        {uploading ? 'Uploading...' : 'Upload ZIP'}
      </button>

      {result && (
        <div style={{ marginTop: '20px' }}>
          <p>Upload Complete:</p>
          <ul>
            <li>Images: {result.count}</li>
            <li>With masks: {result.masksCount}</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default ZipUploadButton;
