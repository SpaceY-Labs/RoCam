/**
 * useProjectState - Hook for managing project selection and list
 * Handles loading projects, selecting projects, and fetching project details
 */

import { useCallback, useEffect, useState } from 'react';
import type { Project } from '../types';
import { listProjects, getProject, listImages, deleteProject as apiDeleteProject } from '../modules/API_Helps';

// ============ Types ============
export interface UseProjectStateReturn {
  /** List of all projects */
  projects: Project[];
  /** Currently selected project ID */
  selectedProjectId: string | null;
  /** Detailed project data for selected project */
  projectDetails: Project | null;
  /** Computed selected project (details + list counts) */
  selectedProject: Project | null;
  /** Whether projects are loading */
  loading: boolean;
  /** Refresh the projects list */
  refreshProjects: () => Promise<void>;
  /** Load details for a specific project */
  loadProjectDetails: (projectId: string) => Promise<void>;
  /** Select a project by ID */
  selectProject: (projectId: string | null) => void;
  /** Delete a project */
  deleteProject: (projectId: string) => Promise<void>;
  /** Clear project details */
  clearProjectDetails: () => void;
}

// ============ Helpers ============

/**
 * Get count from API response
 */
const getResponseCount = (response: { total?: number; items: unknown[] }): number =>
  typeof response.total === 'number' ? response.total : response.items.length;

// ============ Hook ============

/**
 * Manages project list and selection state
 * @returns Project state and handlers
 */
export function useProjectState(): UseProjectStateReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  // ============ Computed State ============

  // Merge project details with list counts
  const projectFromList = projects.find((p) => p.projectId === selectedProjectId) || null;
  const selectedProject = projectDetails
    ? {
        ...projectDetails,
        imageCount: projectFromList?.imageCount ?? projectDetails.imageCount,
        labeledCount: projectFromList?.labeledCount ?? projectDetails.labeledCount,
        unlabeledCount: projectFromList?.unlabeledCount ?? projectDetails.unlabeledCount,
      }
    : projectFromList;

  // ============ API Operations ============

  /**
   * Refresh the projects list and fetch counts
   */
  const refreshProjects = useCallback(async () => {
    setLoading(true);

    try {
      const response = await listProjects();

      const items = (response.items || []).map((item) => ({
        projectId: item.projectId,
        name: item.name,
        description: item.description || null,
        labels: item.labels || {},
        createdAt: item.createdAt || new Date().toISOString(),
        imageCount: item.imageCount || 0,
        labeledCount: item.labeledCount || 0,
      }));

      // Fetch counts for each project in parallel
      const itemsWithCounts = await Promise.all(
        items.map(async (item) => {
          try {
            const [totalResponse, unlabeledResponse] = await Promise.all([
              listImages(item.projectId, { includeTotal: true, limit: 1 }),
              listImages(item.projectId, { status: 'unlabeled', includeTotal: true, limit: 1 }),
            ]);

            const total = getResponseCount(totalResponse);
            const unlabeled = getResponseCount(unlabeledResponse);
            const labeled = Math.max(total - unlabeled, 0);

            return {
              ...item,
              imageCount: total,
              labeledCount: labeled,
              unlabeledCount: unlabeled,
            };
          } catch {
            return item;
          }
        })
      );

      setProjects(itemsWithCounts);

      // Auto-select first project if none selected
      setSelectedProjectId((prev) => prev ?? itemsWithCounts[0]?.projectId ?? null);
    } catch (err) {
      console.error('Failed to load projects:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load details for a specific project
   */
  const loadProjectDetails = useCallback(async (projectId: string) => {
    try {
      const details = await getProject(projectId);

      setProjectDetails({
        projectId: details.projectId,
        name: details.name,
        description: details.description || null,
        labels: details.labels || {},
        createdAt: details.createdAt || new Date().toISOString(),
        imageCount: details.imageCount || 0,
        labeledCount: details.labeledCount || 0,
      });
    } catch (err) {
      console.error('Failed to load project details:', err);
      throw err;
    }
  }, []);

  /**
   * Select a project by ID
   */
  const selectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
    if (!projectId) {
      setProjectDetails(null);
    }
  }, []);

  /**
   * Delete a project
   */
  const deleteProject = useCallback(
    async (projectId: string) => {
      await apiDeleteProject(projectId);

      // Remove from list
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));

      // Clear selection if deleted project was selected
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setProjectDetails(null);
      }
    },
    [selectedProjectId]
  );

  /**
   * Clear project details
   */
  const clearProjectDetails = useCallback(() => {
    setProjectDetails(null);
  }, []);

  // ============ Effects ============

  // Load project details when selection changes
  useEffect(() => {
    if (!selectedProjectId) {
      setProjectDetails(null);
      return;
    }
    loadProjectDetails(selectedProjectId);
  }, [loadProjectDetails, selectedProjectId]);

  return {
    projects,
    selectedProjectId,
    projectDetails,
    selectedProject,
    loading,
    refreshProjects,
    loadProjectDetails,
    selectProject,
    deleteProject,
    clearProjectDetails,
  };
}

export default useProjectState;
