/**
 * GalleryGrid - Grid layout for image previews
 * Renders preview cards in responsive grid
 */

import type { ProjectImage, SparseColorMap } from '../../../types';
import { PreviewCard } from './PreviewCard';

// ============ Types ============
export interface GalleryGridProps {
  /** List of images */
  images: ProjectImage[];
  /** Color maps keyed by image ID */
  colorMaps: Record<string, SparseColorMap | null | undefined>;
  /** Callback when image is clicked */
  onImageClick: (image: ProjectImage) => void;
}

// ============ Component ============
export function GalleryGrid({ images, colorMaps, onImageClick }: GalleryGridProps) {
  return (
    <div className="gallery-grid">
      {images.map((image) => (
        <div
          key={image.imageId}
          className="gallery-card-wrapper"
          role="button"
          tabIndex={0}
          onClick={() => onImageClick(image)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onImageClick(image);
            }
          }}
        >
          <PreviewCard image={image} colorMap={colorMaps[image.imageId]} />
        </div>
      ))}
    </div>
  );
}

export default GalleryGrid;
