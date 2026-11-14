'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export interface GlobalErrorBoundaryProps {
  children: ReactNode;
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
      errorMessage: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[GlobalErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, errorMessage: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-screen w-full flex-col items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-center text-[var(--ps-text)]"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-lg">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--ps-text)]">
              Something went wrong. Please refresh the page.
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
              {this.state.errorMessage ||
                'We encountered an unexpected error while rendering the workspace.'}
            </p>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Refresh Page</span>
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
