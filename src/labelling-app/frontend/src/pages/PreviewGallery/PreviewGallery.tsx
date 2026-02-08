/**
 * PreviewGallery - Image management gallery page
 * Shows paginated grid of images with management modal
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectImage, SparseColorMap } from '../../types';
import {
  getColorMap,
  listImages,
  downloadProjectZip,
  deleteImage,
} from '../../modules/API_Helps';
import { Button, EmptyState, LoadingState, Modal, ConfirmModal } from '../../components/ui';
import { ManagementModal } from '../../components/ManagementModal';
import { Pagination } from './components/Pagination';
import { PER_PAGE_OPTIONS } from './components/paginationConstants';
import { GalleryGrid } from './components/GalleryGrid';
import './PreviewGallery.css';

// ============ Types ============
export interface PreviewGalleryProps {
  /** Current project */
  project: Project | null;
  /** Callback to navigate to projects */
  onSelectProject: () => void;
}

// ============ Component ============
export function PreviewGallery({ project, onSelectProject }: PreviewGalleryProps) {
  const projectId = project?.projectId;

  // ============ State ============
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [colorMaps, setColorMaps] = useState<Record<string, SparseColorMap | null | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[1]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [cursorParam, setCursorParam] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<ProjectImage | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [deleteImageTarget, setDeleteImageTarget] = useState<ProjectImage | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Computed pagination
  const pageIndex = cursorStack.length + 1;
  const pageCount = total ? Math.max(1, Math.ceil(total / perPage)) : null;

  // ============ Helpers ============

  const resetPaging = () => {
    setCursorStack([]);
    setCursorParam(null);
    setNextCursor(null);
    setTotal(null);
  };

  // ============ API Operations ============

  const loadPage = useCallback(
    async (cursor: string | null) => {
      if (!projectId) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError(null);
      setCursorParam(cursor);

      try {
        const response = await listImages(projectId, {
          limit: perPage,
          cursor: cursor || undefined,
          includeTotal: !cursor,
          includeFileUrl: true,
        });

        if (requestIdRef.current !== requestId) return;

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
        setNextCursor(response.cursor || null);
        if (!cursor && typeof response.total === 'number') {
          setTotal(response.total);
        }

        // Load color maps
        const overlaySeed: Record<string, SparseColorMap | null | undefined> = {};
        items.forEach((item) => {
          overlaySeed[item.imageId] = undefined;
        });
        setColorMaps(overlaySeed);

        await Promise.all(
          items.map(async (item) => {
            try {
              if (!item.maskMapId) {
                overlaySeed[item.imageId] = null;
                return;
              }
              const colorMap = await getColorMap(projectId, item.maskMapId);
              overlaySeed[item.imageId] = colorMap;
            } catch {
              overlaySeed[item.imageId] = null;
            }
          })
        );

        if (requestIdRef.current !== requestId) return;
        setColorMaps({ ...overlaySeed });
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : 'Failed to load images');
        setImages([]);
        setColorMaps({});
        setNextCursor(null);
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [perPage, projectId]
  );

  // ============ Effects ============

  useEffect(() => {
    if (!projectId) {
      setImages([]);
      setColorMaps({});
      resetPaging();
      return;
    }
    resetPaging();
    loadPage(null);
  }, [loadPage, projectId, perPage]);

  // ============ Handlers ============

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursorParam]);
    loadPage(nextCursor);
  };

  const handlePrev = () => {
    if (cursorStack.length === 0) return;
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack((prev) => prev.slice(0, -1));
    loadPage(previous);
  };

  const handleImageUpdated = useCallback(
    (
      imageId: string,
      updates: {
        meta?: {
          status?: ProjectImage['meta']['status'];
          tags?: string[];
        };
        labelComplete?: boolean;
        reviewed?: boolean;
      }
    ) => {
      const applyUpdates = (image: ProjectImage) => {
        const nextMeta = updates.meta
          ? {
              ...image.meta,
              ...(updates.meta.status !== undefined ? { status: updates.meta.status } : {}),
              ...(updates.meta.tags !== undefined ? { tags: updates.meta.tags } : {}),
            }
          : image.meta;
        return {
          ...image,
          meta: nextMeta,
          labelComplete:
            updates.labelComplete !== undefined ? updates.labelComplete : image.labelComplete,
          reviewed: updates.reviewed !== undefined ? updates.reviewed : image.reviewed,
        };
      };

      setImages((prev) =>
        prev.map((image) => (image.imageId === imageId ? applyUpdates(image) : image))
      );
      setActiveImage((prev) => (prev && prev.imageId === imageId ? applyUpdates(prev) : prev));
    },
    []
  );

  const handleColorMapUpdated = useCallback((imageId: string, map: SparseColorMap | null) => {
    setColorMaps((prev) => ({ ...prev, [imageId]: map }));
  }, []);

  const openManagement = (image: ProjectImage) => {
    setActiveImage(image);
  };

  const closeManagement = () => {
    setActiveImage(null);
  };

  const requestDeleteImage = (image: ProjectImage) => {
    setDeleteImageTarget(image);
  };

  const handleConfirmDeleteImage = async () => {
    if (!projectId || !deleteImageTarget || deletingImageId) return;
    setDeletingImageId(deleteImageTarget.imageId);
    try {
      await deleteImage(projectId, deleteImageTarget.imageId);
      setImages((prev) => prev.filter((img) => img.imageId !== deleteImageTarget.imageId));
      setColorMaps((prev) => {
        const next = { ...prev };
        delete next[deleteImageTarget.imageId];
        return next;
      });
      if (activeImage?.imageId === deleteImageTarget.imageId) {
        setActiveImage(null);
      }
      setTotal((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
      setDeleteImageTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete image');
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleDownloadZip = async () => {
    if (!projectId) return;
    setDownloadLoading(true);
    setError(null);
    try {
      await downloadProjectZip(projectId, { limit: 100 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadLoading(false);
    }
  };

  const currentImageIndex = activeImage
    ? images.findIndex((img) => img.imageId === activeImage.imageId)
    : -1;
  const hasPrevImage = currentImageIndex > 0;
  const hasNextImage = currentImageIndex >= 0 && currentImageIndex < images.length - 1;

  // ============ Empty States ============

  if (!project) {
    return (
      <EmptyState
        title="Select a project"
        description="Choose a project to manage its images and metadata."
        action={{ label: 'Go to projects', onClick: onSelectProject }}
      />
    );
  }

  if (loading && images.length === 0) {
    return <LoadingState message="Loading images..." />;
  }

  // ============ Render ============
  return (
    <div className="gallery">
      {/* Toolbar */}
      <div className="gallery-toolbar">
        <div>
          <p className="eyebrow">Management Panel</p>
          <h2>Image Management</h2>
          <p className="muted small">
            {total !== null ? `${total} total images` : 'All available images'}
          </p>
        </div>
        <div className="gallery-toolbar-actions">
          <Pagination
            pageIndex={pageIndex}
            pageCount={pageCount}
            perPage={perPage}
            hasPrevious={cursorStack.length > 0}
            hasNext={Boolean(nextCursor)}
            onPerPageChange={setPerPage}
            onPrevious={handlePrev}
            onNext={handleNext}
          />
          <Button
            variant="secondary"
            onClick={handleDownloadZip}
            disabled={downloadLoading || (total !== null && total === 0)}
            loading={downloadLoading}
          >
            Download ZIP
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button className="btn btn-ghost btn-small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && images.length > 0 && (
        <div className="gallery-loading-row">
          <div className="loading-spinner" />
          <span>Refreshing images...</span>
        </div>
      )}

      {/* Gallery Grid */}
      {images.length === 0 ? (
        <EmptyState
          title="No images found"
          description="Upload images to start managing labels and tags."
        />
      ) : (
        <GalleryGrid
          images={images}
          colorMaps={colorMaps}
          onImageClick={openManagement}
          onDeleteImage={requestDeleteImage}
        />
      )}

      {/* Management Modal */}
      <Modal
        isOpen={Boolean(activeImage)}
        onClose={closeManagement}
        title="Manage Image"
        contentClassName="management-modal-content"
      >
        {activeImage && project && (
          <ManagementModal
            project={project}
            image={activeImage}
            colorMap={colorMaps[activeImage.imageId]}
            onClose={closeManagement}
            hasPrevImage={hasPrevImage}
            hasNextImage={hasNextImage}
            onPrevImage={hasPrevImage ? () => setActiveImage(images[currentImageIndex - 1]) : undefined}
            onNextImage={hasNextImage ? () => setActiveImage(images[currentImageIndex + 1]) : undefined}
            onImageUpdated={handleImageUpdated}
            onColorMapUpdated={handleColorMapUpdated}
          />
        )}
      </Modal>

      {/* Delete Image Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteImageTarget)}
        onClose={() => setDeleteImageTarget(null)}
        onConfirm={handleConfirmDeleteImage}
        title="Delete image"
        message={
          deleteImageTarget
            ? `Are you sure you want to delete "${deleteImageTarget.meta.fileName}"? This will remove the image and its masks from the project.`
            : ''
        }
        confirmText={deletingImageId ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

export default PreviewGallery;
