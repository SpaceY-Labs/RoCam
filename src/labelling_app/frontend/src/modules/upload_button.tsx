import { useState, type ChangeEvent } from 'react';
import { uploadImageToBackend } from './API_Helps';

type ImageUploadButtonProps = {
  projectId: string;
  status?: 'unlabeled' | 'in_progress' | 'labeled';
  tags?: string[];
};

const ImageUploadButton = ({ projectId, status = 'unlabeled', tags = [] }: ImageUploadButtonProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file first!");

    setUploading(true);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        const previewUrl = URL.createObjectURL(file);
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
          URL.revokeObjectURL(previewUrl);
        };
        img.src = previewUrl;
      });

      await uploadImageToBackend(projectId, file, {
        fileName: file.name,
        width: dimensions.width,
        height: dimensions.height,
        status,
        tags,
      });

      const previewUrl = URL.createObjectURL(file);
      setImageUrl(previewUrl);
      alert("Upload successful!");
    } catch {
      alert("Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <input type="file" onChange={handleFileChange} accept="image/*" />
      
      <button 
        onClick={handleUpload} 
        disabled={uploading || !file}
        style={{ marginLeft: '10px', cursor: uploading ? 'not-allowed' : 'pointer' }}
      >
        {uploading ? 'Uploading...' : 'Upload to Cloud'}
      </button>

      {imageUrl && (
        <div style={{ marginTop: '20px' }}>
          <p>Uploaded Image:</p>
          <img src={imageUrl} alt="Uploaded" style={{ maxWidth: '200px' }} />
        </div>
      )}
    </div>
  );
};

export default ImageUploadButton;
