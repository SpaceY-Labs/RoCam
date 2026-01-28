/**
 * useMaskHover - Hook for managing mask hover state with delay
 * Provides hover detection with configurable delay before highlighting
 */

import { useCallback, useRef, useState } from 'react';

// ============ Constants ============
const DEFAULT_HOVER_DELAY_MS = 1000;

// ============ Types ============
export interface UseMaskHoverOptions {
  /** Delay in ms before highlighting (default: 1000ms) */
  hoverDelay?: number;
  /** Callback when mask is highlighted */
  onHighlight?: (maskId: string | null) => void;
}

export interface UseMaskHoverReturn {
  /** Currently hovered mask ID (immediate) */
  hoveredMaskId: string | null;
  /** Currently highlighted mask ID (after delay) */
  highlightedMaskId: string | null;
  /** Handler for mouse move events */
  handleMouseMove: (maskId: string | null) => void;
  /** Handler for mouse leave events */
  handleMouseLeave: () => void;
  /** Reset all hover state */
  reset: () => void;
}

// ============ Hook ============

/**
 * Manages mask hover state with a delay before highlighting
 * @param options Configuration options
 * @returns Hover state and handlers
 */
export function useMaskHover(options: UseMaskHoverOptions = {}): UseMaskHoverReturn {
  const { hoverDelay = DEFAULT_HOVER_DELAY_MS, onHighlight } = options;

  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null);
  const [highlightedMaskId, setHighlightedMaskId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Clear the hover timer
   */
  const clearTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  /**
   * Handle mouse move - update hover state and start delay timer
   */
  const handleMouseMove = useCallback(
    (maskId: string | null) => {
      if (maskId === hoveredMaskId) return;

      setHoveredMaskId(maskId);
      clearTimer();

      if (!maskId) {
        setHighlightedMaskId(null);
        onHighlight?.(null);
      } else {
        hoverTimerRef.current = setTimeout(() => {
          setHighlightedMaskId(maskId);
          onHighlight?.(maskId);
        }, hoverDelay);
      }
    },
    [clearTimer, hoverDelay, hoveredMaskId, onHighlight]
  );

  /**
   * Handle mouse leave - clear all hover state
   */
  const handleMouseLeave = useCallback(() => {
    setHoveredMaskId(null);
    setHighlightedMaskId(null);
    clearTimer();
    onHighlight?.(null);
  }, [clearTimer, onHighlight]);

  /**
   * Reset all hover state
   */
  const reset = useCallback(() => {
    setHoveredMaskId(null);
    setHighlightedMaskId(null);
    clearTimer();
  }, [clearTimer]);

  return {
    hoveredMaskId,
    highlightedMaskId,
    handleMouseMove,
    handleMouseLeave,
    reset,
  };
}

export default useMaskHover;
