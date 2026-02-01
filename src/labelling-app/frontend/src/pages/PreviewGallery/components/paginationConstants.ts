/**
 * Pagination constants and types
 */

export const PER_PAGE_OPTIONS = [6, 12, 24, 48];

export interface PaginationProps {
  pageIndex: number;
  pageCount: number | null;
  perPage: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPerPageChange: (perPage: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}
