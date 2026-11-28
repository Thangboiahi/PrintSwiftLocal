'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Compass, Home, RotateCcw } from 'lucide-react';

export interface GlobalErrorBoundaryProps {
  children: ReactNode;
  contextLabel?: string;
}

export interface GlobalErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return {
      hasError: true,
      errorMessage:
        error?.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[GlobalErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoHome = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  };

  handleGoExplore = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    if (typeof window !== 'undefined') {
      window.location.assign('/explore');
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="global-error-boundary-fallback"
          className="flex min-h-[70dvh] w-full flex-col items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-center text-[var(--ps-text)]"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--ps-text)]">
              {this.props.contextLabel
                ? `${this.props.contextLabel} hit a snag`
                : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
              {this.state.errorMessage ||
                'We ran into an unexpected problem loading this view. You can try reloading or jump straight back to Home or Explore.'}
            </p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
              <button
                type="button"
                onClick={this.handleRetry}
                data-testid="error-boundary-retry-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Try Again</span>
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                data-testid="error-boundary-home-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Go to Home</span>
              </button>
              <button
                type="button"
                onClick={this.handleGoExplore}
                data-testid="error-boundary-explore-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Explore Map</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
