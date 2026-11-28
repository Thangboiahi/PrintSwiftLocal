'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';


export interface ConfirmActionModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmActionModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  const mounted = useHydrated();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!mounted) return null;

  const isDanger = variant === 'danger';

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-action-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => {
              if (!loading) onCancel();
            }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    isDanger
                      ? 'border-rose-500/30 bg-rose-500/12 text-rose-600 dark:text-rose-400'
                      : 'border-theme-primary/25 bg-theme-primary/10 text-theme-primary'
                  }`}
                >
                  {isDanger ? (
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3
                    id="confirm-action-modal-title"
                    className="text-sm font-bold leading-snug text-[var(--ps-text)]"
                  >
                    {title}
                  </h3>
                  {description && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                aria-label="Close confirmation dialog"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[var(--ps-text-muted)] transition-colors hover:border-[var(--ps-border)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 bg-[var(--ps-bg)]/55 px-5 py-3.5">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-bg)] disabled:opacity-50 cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={loading}
                className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50 cursor-pointer ${
                  isDanger
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-theme-primary text-theme-primary-foreground'
                }`}
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{confirmLabel}</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export interface ConfirmDialogRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmDialogRequest): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setRequest(opts);
    });
  }, []);

  const handleClose = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) resolve(accepted);
  }, []);

  const dialog = (
    <ConfirmActionModal
      isOpen={Boolean(request)}
      title={request?.title ?? ''}
      description={request?.description}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      variant={request?.variant ?? 'default'}
      onConfirm={() => handleClose(true)}
      onCancel={() => handleClose(false)}
    />
  );

  return { confirm, dialog };
}
