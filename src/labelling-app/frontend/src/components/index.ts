/**
 * Components - Barrel exports
 *
 * Note: These exports are kept for backwards compatibility.
 * Prefer importing from './pages' for page components
 * and './components/shared' for shared components.
 */

// Legacy exports (from old location)
export { ProjectList } from './ProjectList';
export { CreateProject } from './CreateProject';
export { ImageUpload } from './ImageUpload';
export { PreviewGallery } from './PreviewGallery';
export { ManagementModal } from './ManagementModal';

// UI components
export * from './ui';

// Shared components
export * from './shared';
