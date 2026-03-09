import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import { logger } from '../lib/logger';

type ErrorBoundaryState = {
  hasError: boolean;
  message: string | null;
};

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('error-boundary', 'The React tree crashed.', {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[var(--surface-0)] px-6 py-10 text-[var(--ink-1)]">
          <section className="mx-auto max-w-3xl border border-[var(--line-strong)] bg-[var(--surface-1)] p-8 shadow-[var(--shadow-soft)]">
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Shell Failure</p>
            <h1 className="mt-4 font-display text-4xl">The app shell hit an unrecoverable UI error.</h1>
            <p className="mt-4 max-w-2xl text-base text-[var(--ink-2)]">
              Check the browser console and the Rust log file. Phase 1 keeps failures loud on purpose so an
              agent can recover quickly.
            </p>
            <pre className="mt-6 overflow-x-auto bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-2)]">
              {this.state.message}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
