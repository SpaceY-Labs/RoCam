import { useState } from 'react';
import { uploadImageToFirebase } from './API_Helps';

const ImageUploadButton = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  const handleFileChange = (e : any) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select a file first!");

    setUploading(true);
    try {
      const url = await uploadImageToFirebase(file);
      setImageUrl(url as string);
      alert("Upload successful!");
    } catch (err) {
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