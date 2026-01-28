/**
 * Pagination - Gallery pagination controls
 * Handles page navigation and per-page selection
 */

import { Button } from '../../../components/ui';

// ============ Constants ============
export const PER_PAGE_OPTIONS = [6, 12, 24, 48];

// ============ Types ============
export interface PaginationProps {
  /** Current page index (1-based) */
  pageIndex: number;
  /** Total page count (null if unknown) */
  pageCount: number | null;
  /** Items per page */
  perPage: number;
  /** Whether previous page exists */
  hasPrevious: boolean;
  /** Whether next page exists */
  hasNext: boolean;
  /** Callback when per-page changes */
  onPerPageChange: (perPage: number) => void;
  /** Callback when previous is clicked */
  onPrevious: () => void;
  /** Callback when next is clicked */
  onNext: () => void;
}

// ============ Component ============
export function Pagination({
  pageIndex,
  pageCount,
  perPage,
  hasPrevious,
  hasNext,
  onPerPageChange,
  onPrevious,
  onNext,
}: PaginationProps) {
  return (
    <div className="gallery-controls">
      <label className="gallery-label">
        Per page
        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="gallery-pagination">
        <Button variant="ghost" onClick={onPrevious} disabled={!hasPrevious}>
          Prev
        </Button>
        <span className="gallery-page">
          Page {pageIndex}
          {pageCount ? ` of ${pageCount}` : ''}
        </span>
        <Button variant="ghost" onClick={onNext} disabled={!hasNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

export default Pagination;
