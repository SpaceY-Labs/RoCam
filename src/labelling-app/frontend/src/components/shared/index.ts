/**
 * Shared components - Barrel exports
 */

// MaskCanvas - Canvas component for mask overlays
export { MaskCanvas, useMaskHover } from './MaskCanvas';
export type { MaskCanvasProps, UseMaskHoverOptions, UseMaskHoverReturn } from './MaskCanvas';

// LabelPopup - Popup for assigning labels
export { LabelPopup } from './LabelPopup';
export type { LabelPopupProps, LabelPopupPosition } from './LabelPopup';

// Navigation - Sidebar component
export { Sidebar, NAV_ITEMS } from './Navigation';
export type { SidebarProps } from './Navigation';
