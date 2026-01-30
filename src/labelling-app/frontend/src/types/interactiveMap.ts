import type { MaskOverlay } from './index';

/**
 * Coordinate data for positioning and transforming between display and natural image space.
 */
export interface InteractiveMapCoordinates {
  displayWidth: number;
  displayHeight: number;
  offsetX: number;
  offsetY: number;
  naturalWidth: number;
  naturalHeight: number;
  /** Scale factor from natural to display (natural → display) */
  scaleX: number;
  scaleY: number;
}

/**
 * Pre-rendered interactive map combining image + masks with baked-in coordinate logic.
 */
export interface InteractiveMap {
  /** Pre-rendered canvas with image + masks combined */
  canvas: HTMLCanvasElement;

  /** Coordinate data for positioning and transformations */
  coordinates: InteractiveMapCoordinates;

  /** Original mask data for lookups */
  maskOverlay: MaskOverlay;

  /**
   * Lookup mask at screen position.
   * @param clientX - Mouse/client X
   * @param clientY - Mouse/client Y
   * @param imageRect - Current image getBoundingClientRect()
   * @returns maskId or null if no mask at position
   */
  getMaskAtPosition(clientX: number, clientY: number, imageRect: DOMRect): string | null;
}
