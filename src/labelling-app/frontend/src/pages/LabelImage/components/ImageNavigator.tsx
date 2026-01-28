/**
 * ImageNavigator - Navigation controls for images
 * Previous/Next buttons and image counter
 */

import { Button } from '../../../components/ui';

// ============ Types ============
export interface ImageNavigatorProps {
  /** Current image index (0-based) */
  currentIndex: number;
  /** Total number of images */
  totalImages: number;
  /** Callback when previous is clicked */
  onPrevious: () => void;
  /** Callback when next is clicked */
  onNext: () => void;
  /** Whether navigation is disabled */
  disabled?: boolean;
}

// ============ Component ============
export function ImageNavigator({
  currentIndex,
  totalImages,
  onPrevious,
  onNext,
  disabled = false,
}: ImageNavigatorProps) {
  const isAtStart = currentIndex === 0;
  const isAtEnd = currentIndex >= totalImages - 1;

  return (
    <div className="toolbar-left">
      <Button
        variant="ghost"
        size="small"
        onClick={onPrevious}
        disabled={disabled || isAtStart}
      >
        Previous
      </Button>
      <span className="image-counter">
        {currentIndex + 1} / {totalImages}
      </span>
      <Button
        variant="ghost"
        size="small"
        onClick={onNext}
        disabled={disabled || isAtEnd}
      >
        Next
      </Button>
    </div>
  );
}

export default ImageNavigator;
