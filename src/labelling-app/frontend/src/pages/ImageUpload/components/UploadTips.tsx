/**
 * UploadTips - Helpful tips for uploading images
 */

import { Card } from '../../../components/ui';

// ============ Component ============
export function UploadTips() {
  return (
    <Card variant="bordered" padding="small" className="upload-tips">
      <h4>Tips</h4>
      <ul>
        <li>ZIP files should contain images (JPG, PNG, WebP)</li>
        <li>Use descriptive tags to organize your images</li>
        <li>Set status to "unlabeled" for new images</li>
      </ul>
    </Card>
  );
}

export default UploadTips;
