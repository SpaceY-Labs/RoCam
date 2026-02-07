/**
 * Pure storage path builders (no Firebase dependency).
 * Used by storage.ts and testable without env.
 */

export const buildMaskStoragePath = (
  projectId: string,
  imageId: string,
  maskId: string
): string => {
  return `projects/${projectId}/images/${imageId}/masks/${maskId}.bin`;
};

export const buildColorMapStoragePath = (
  projectId: string,
  maskMapId: string
): string => {
  return `projects/${projectId}/maskmaps/${maskMapId}/colormap.json`;
};

export const buildMaskOverlayStoragePath = (
  projectId: string,
  maskMapId: string
): string => {
  return `projects/${projectId}/maskmaps/${maskMapId}/maskoverlay.json`;
};
