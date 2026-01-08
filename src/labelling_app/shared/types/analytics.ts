import type { Timestamp } from 'firebase/firestore';

/**
 * Project-level analytics
 */
export interface ProjectAnalytics {
  overview: OverviewStats;
  timeline: TimelineDataPoint[];
  classDistribution: ClassDistributionItem[];
  teamPerformance: TeamMemberPerformance[];
}

/**
 * Overview statistics
 */
export interface OverviewStats {
  totalImages: number;
  labeledImages: number;
  inProgressImages: number;
  unlabeledImages: number;
  totalMasks: number;
  avgMasksPerImage: number;
  completionRate: number; // 0-100
}

/**
 * Timeline data point for charts
 */
export interface TimelineDataPoint {
  date: string; // ISO date string
  labeled: number;
  uploaded: number;
  cumulative: number;
}

/**
 * Class distribution for pie/bar charts
 */
export interface ClassDistributionItem {
  classId: string;
  className: string;
  color: string;
  count: number;
  percentage: number;
}

/**
 * Team member performance metrics
 */
export interface TeamMemberPerformance {
  userId: string;
  displayName: string;
  assigned: number;
  labeled: number;
  completionRate: number;
  avgTimePerImage: number; // Milliseconds
  lastActiveAt: Timestamp;
}

/**
 * Analytics query params
 */
export interface AnalyticsQueryParams {
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'week' | 'month';
}
