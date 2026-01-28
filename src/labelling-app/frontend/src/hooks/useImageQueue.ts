/**
 * useImageQueue - Hook for managing the labeling image queue
 * Handles loading available images and tracking queue navigation
 */

import { useCallback, useState } from 'react';
import type { ProjectImage } from '../types';
import { getAvailableImages } from '../modules/API_Helps';

// ============ Constants ============
const DEFAULT_BATCH_SIZE = 5;

// ============ Types ============
export interface UseImageQueueOptions {
  /** Number of images to fetch per batch (default: 5) */
  batchSize?: number;
}

export interface UseImageQueueReturn {
  /** Available images in the queue */
  images: ProjectImage[];
  /** Current index in the queue */
  currentIndex: number;
  /** Current image */
  currentImage: ProjectImage | null;
  /** Whether queue is loading */
  loading: boolean;
  /** Load available images */
  loadQueue: (projectId: string, lockedIds?: string[]) => Promise<ProjectImage[]>;
  /** Move to next image */
  nextImage: () => void;
  /** Move to previous image */
  prevImage: () => void;
  /** Set current index */
  setIndex: (index: number) => void;
  /** Clear the queue */
  clearQueue: () => void;
  /** Remove an image from the queue */
  removeImage: (imageId: string) => void;
  /** Check if at end of queue */
  isAtEnd: boolean;
  /** Check if at start of queue */
  isAtStart: boolean;
}

// ============ Hook ============

/**
 * Manages the labeling image queue
 * @param options Configuration options
 * @returns Queue state and handlers
 */
export function useImageQueue(options: UseImageQueueOptions = {}): UseImageQueueReturn {
  const { batchSize = DEFAULT_BATCH_SIZE } = options;

  const [images, setImages] = useState<ProjectImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // ============ Computed State ============
  const currentImage = images[currentIndex] || null;
  const isAtEnd = currentIndex >= images.length - 1;
  const isAtStart = currentIndex === 0;

  // ============ Queue Operations ============

  /**
   * Load available images from the API
   * @returns Array of loaded images (for use with lock acquisition)
   */
  const loadQueue = useCallback(
    async (projectId: string): Promise<ProjectImage[]> => {
      setLoading(true);

      try {
        const response = await getAvailableImages(projectId, {
          limit: batchSize,
          status: 'unlabeled',
          includeFileUrl: true,
        });

        const items = (response.items || []).map((item) => ({
          imageId: item.imageId,
          projectId: projectId,
          maskMapId: item.maskMapId || null,
          labelComplete: item.labelComplete || false,
          reviewed: item.reviewed || false,
          meta: {
            fileName: item.meta?.fileName || 'Unknown',
            width: item.meta?.width || 0,
            height: item.meta?.height || 0,
            status: item.meta?.status || 'unlabeled',
            tags: item.meta?.tags || [],
          },
          fileUrl: item.fileUrl,
          createdAt: item.createdAt || new Date().toISOString(),
        }));

        setImages(items);
        setCurrentIndex(0);
        return items;
      } catch (err) {
        console.error('Failed to load image queue:', err);
        setImages([]);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [batchSize]
  );

  /**
   * Move to next image in queue
   */
  const nextImage = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, images.length - 1));
  }, [images.length]);

  /**
   * Move to previous image in queue
   */
  const prevImage = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  /**
   * Set current index directly
   */
  const setIndex = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(index, images.length - 1)));
    },
    [images.length]
  );

  /**
   * Clear the queue
   */
  const clearQueue = useCallback(() => {
    setImages([]);
    setCurrentIndex(0);
  }, []);

  /**
   * Remove an image from the queue
   */
  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => {
      const newImages = prev.filter((img) => img.imageId !== imageId);
      // Adjust current index if needed
      setCurrentIndex((prevIndex) =>
        prevIndex >= newImages.length ? Math.max(0, newImages.length - 1) : prevIndex
      );
      return newImages;
    });
  }, []);

  return {
    images,
    currentIndex,
    currentImage,
    loading,
    loadQueue,
    nextImage,
    prevImage,
    setIndex,
    clearQueue,
    removeImage,
    isAtEnd,
    isAtStart,
  };
}

export default useImageQueue;
