'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Info,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';

const emptySubscribe = () => () => {};

export type ConfirmDialogVariant = 'info' | 'warning' | 'danger';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  caution?: string;
  impactSummary?: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  caution,
  impactSummary,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'info',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, loading, onCancel]);

  if (!mounted) return null;

  const impactList = Array.isArray(impactSummary)
    ? impactSummary.filter(Boolean)
    : impactSummary
      ? [impactSummary]
      : [];

  const toneConfig =
    variant === 'danger'
      ? {
          icon: ShieldAlert,
          iconWrap:
            'border-rose-500/30 bg-rose-500/12 text-rose-600 dark:text-rose-400',
          confirmBtn:
            'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
          cautionBox:
            'border-rose-500/25 bg-rose-500/8 text-rose-700 dark:text-rose-300',
        }
      : variant === 'warning'
        ? {
            icon: AlertTriangle,
            iconWrap:
              'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
            confirmBtn:
              'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500',
            cautionBox:
              'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
          }
        : {
            icon: Info,
            iconWrap:
              'border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]',
            confirmBtn:
              'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95 focus-visible:ring-[var(--ps-ring)]',
            cautionBox:
              'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
          };

  const ToneIcon = toneConfig.icon;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={() => {
              if (!loading) onCancel();
            }}
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneConfig.iconWrap}`}
                >
                  <ToneIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3
                    id={titleId}
                    className="text-sm font-bold leading-snug text-[var(--ps-text)]"
                  >
                    {title}
                  </h3>
                  {description && (
                    <p
                      id={descId}
                      className="mt-1 text-xs leading-relaxed text-[var(--ps-text-muted)]"
                    >
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
                className="flex h-11 w-11 -mr-2 -mt-1 shrink-0 items-center justify-center rounded-xl text-[var(--ps-text-muted)] transition-colors hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body: Caution & Impact Summary */}
            {(caution || impactList.length > 0) && (
              <div className="space-y-3 px-5 py-4">
                {caution && (
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${toneConfig.cautionBox}`}
                  >
                    <span className="font-bold">Caution: </span>
                    {caution}
                  </div>
                )}

                {impactList.length > 0 && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5">
                    <p className="text-[11px] font-bold text-[var(--ps-text)]">
                      Impact Summary
                    </p>
                    <ul className="mt-1.5 space-y-1 text-xs text-[var(--ps-text-muted)]">
                      {impactList.map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span aria-hidden="true" className="text-[var(--ps-accent)]">
                            ·
                          </span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/60 px-5 py-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={loading}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs transition-all focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 cursor-pointer ${toneConfig.confirmBtn}`}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
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
  caution?: string;
  impactSummary?: string | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
}

export function useConfirmDialogState() {
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmDialogRequest): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setRequest(opts);
      });
    },
    []
  );

  const handleClose = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) resolve(accepted);
  }, []);

  const dialog = (
    <ConfirmDialog
      isOpen={Boolean(request)}
      title={request?.title ?? ''}
      description={request?.description}
      caution={request?.caution}
      impactSummary={request?.impactSummary}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      variant={request?.variant ?? 'info'}
      onConfirm={() => handleClose(true)}
      onCancel={() => handleClose(false)}
    />
  );

  return { confirm, dialog };
}

export default ConfirmDialog;
