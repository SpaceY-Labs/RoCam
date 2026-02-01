/**
 * Pagination - Gallery pagination controls
 * Handles page navigation and per-page selection
 */

import { Button } from '../../../components/ui';
import { PER_PAGE_OPTIONS } from './paginationConstants';
import type { PaginationProps } from './paginationConstants';

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
