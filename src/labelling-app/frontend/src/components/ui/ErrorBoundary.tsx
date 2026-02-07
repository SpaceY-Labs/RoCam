/**
 * ErrorBoundary - React error boundary for catching render errors.
 * Displays a fallback UI instead of crashing the whole page.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** Content to render when no error */
  children: ReactNode;
  /** Custom fallback UI (receives error and reset function) */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      return (
        <div className="error-boundary-fallback" data-testid="error-boundary-fallback">
          <div className="error-boundary-content">
            <h4>Something went wrong</h4>
            <p className="muted small">{this.state.error.message}</p>
            <button
              className="btn btn-ghost btn-small"
              onClick={this.reset}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
