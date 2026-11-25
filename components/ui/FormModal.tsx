'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import {
  ConfirmDialog,
  type ConfirmDialogVariant,
} from '@/components/ui/ConfirmDialog';

const emptySubscribe = () => () => {};

interface FormModalValidationContextValue {
  submitAttempted: boolean;
}

const FormModalValidationContext =
  createContext<FormModalValidationContextValue>({
    submitAttempted: false,
  });

/**
 * Lets child inputs inside a FormModal know when the user attempted to submit,
 * so inline field errors appear ONLY after touch/blur OR submit attempt.
 */
export function useFormModalValidation(): FormModalValidationContextValue {
  return useContext(FormModalValidationContext);
}

export interface FormModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  /** Optional hints shown in the collapsible Hints & Cautions header slot */
  hints?: string[];
  /** Optional cautions shown prominently inside the Hints & Cautions slot */
  cautions?: string[];
  /** Extra custom content rendered inside the collapsible Hints slot (e.g. AttributeHintsPopover) */
  hintsSlot?: React.ReactNode;
  /** Whether the form has unsaved edits (triggers dirty-state discard guard on close) */
  isDirty: boolean;
  /** Whether all fields pass real-time validation */
  isValid: boolean;
  /** Optional list of inline blocking validation messages shown above footer after touch/submit */
  validationSummary?: string[];
  /** Optional callback invoked when the user clicks Submit (even if invalid) to reveal inline errors */
  onSubmitAttempt?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  confirmSubmitTitle?: string;
  confirmSubmitDescription?: string;
  confirmSubmitCaution?: string;
  confirmSubmitImpact?: string | string[];
  confirmSubmitVariant?: ConfirmDialogVariant;
  isSubmitting?: boolean;
  maxWidthClassName?: string;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  children: React.ReactNode;
}

export function FormModal({
  isOpen,
  title,
  subtitle,
  hints,
  cautions,
  hintsSlot,
  isDirty,
  isValid,
  validationSummary,
  onSubmitAttempt,
  submitLabel = 'Save Changes',
  cancelLabel = 'Cancel',
  confirmSubmitTitle = 'Confirm Save Changes',
  confirmSubmitDescription = 'Review your changes before writing to Supabase and refreshing the live storefront.',
  confirmSubmitCaution,
  confirmSubmitImpact,
  confirmSubmitVariant = 'info',
  isSubmitting = false,
  maxWidthClassName = 'max-w-2xl',
  onSubmit,
  onClose,
  children,
}: FormModalProps) {
  const titleId = useId();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [showHints, setShowHints] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Reset validation/submit state whenever modal closes programmatically
  useEffect(() => {
    if (!isOpen) {
      queueMicrotask(() => {
        setSubmitAttempted(false);
        setShowHints(false);
        setSubmitConfirmOpen(false);
        setDiscardConfirmOpen(false);
      });
    }
  }, [isOpen]);

  const hasHintsContent =
    Boolean(hints && hints.length > 0) ||
    Boolean(cautions && cautions.length > 0) ||
    Boolean(hintsSlot);

  const requestClose = useCallback(() => {
    if (isSubmitting) return;
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    setShowHints(false);
    setSubmitConfirmOpen(false);
    setSubmitAttempted(false);
    onClose();
  }, [isSubmitting, isDirty, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (discardConfirmOpen || submitConfirmOpen) return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, discardConfirmOpen, submitConfirmOpen, requestClose]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitAttempted(true);
    onSubmitAttempt?.();
    if (!isValid) return;
    setSubmitConfirmOpen(true);
  };

  const handleConfirmedSubmit = async () => {
    await onSubmit();
    setSubmitConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setShowHints(false);
    setSubmitAttempted(false);
  };

  const validationContextValue = useMemo(
    () => ({ submitAttempted: isOpen && submitAttempted }),
    [isOpen, submitAttempted]
  );

  if (!mounted) return null;

  const activeErrors = (validationSummary || []).filter(Boolean);
  // v17a Validation Standard: full-form summary callout appears strictly at submission time
  const showValidationBanner =
    !isValid && activeErrors.length > 0 && submitAttempted;

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={requestClose}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={`relative z-10 flex max-h-[92dvh] w-full ${maxWidthClassName} flex-col overflow-hidden rounded-t-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl sm:rounded-2xl`}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4 shrink-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      id={titleId}
                      className="text-base font-bold tracking-tight text-[var(--ps-text)]"
                    >
                      {title}
                    </h3>
                    {isDirty && (
                      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        · Unsaved edits
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                      {subtitle}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasHintsContent && (
                    <button
                      type="button"
                      onClick={() => setShowHints((prev) => !prev)}
                      aria-expanded={showHints}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                        showHints
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 text-[var(--ps-accent)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden sm:inline">Hints &amp; Cautions</span>
                      {showHints ? (
                        <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={requestClose}
                    disabled={isSubmitting}
                    aria-label="Close modal"
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-transparent text-[var(--ps-text-muted)] transition-colors hover:border-[var(--ps-border)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Collapsible Hints & Cautions Drawer */}
              {hasHintsContent && showHints && (
                <div className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] px-5 py-3.5 space-y-2.5 shrink-0 max-h-[38vh] overflow-y-auto">
                  {cautions && cautions.length > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>Cautions</span>
                      </div>
                      <ul className="space-y-1 pl-5 list-disc">
                        {cautions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {hints && hints.length > 0 && (
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 text-xs text-[var(--ps-text-muted)] space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
                        <Info className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                        <span>Field Guidelines</span>
                      </div>
                      <ul className="space-y-1 pl-5 list-disc">
                        {hints.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {hintsSlot}
                </div>
              )}

              {/* Form Body */}
              <FormModalValidationContext.Provider value={validationContextValue}>
                <form
                  onSubmit={handleFormSubmit}
                  noValidate
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {children}
                  </div>

                  {/* Inline Blocking Validation Summary (Shown ONLY after user interaction or Submit click) */}
                  {showValidationBanner && (
                    <div
                      role="alert"
                      className="border-t border-rose-500/25 bg-rose-500/8 px-5 py-2.5 text-xs text-rose-700 dark:text-rose-300 shrink-0"
                    >
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold">
                            Fix {activeErrors.length} validation{' '}
                            {activeErrors.length === 1 ? 'issue' : 'issues'} to save:
                          </span>{' '}
                          <span>{activeErrors[0]}</span>
                          {activeErrors.length > 1 && (
                            <span className="opacity-80">
                              {' '}
                              (+{activeErrors.length - 1} more)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Modal Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/65 px-5 py-3 shrink-0">
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      {isDirty
                        ? 'Changes are confirmed before publishing.'
                        : 'No unsaved edits yet.'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={requestClose}
                        disabled={isSubmitting}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                      >
                        {cancelLabel}
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer ${
                          submitAttempted && !isValid ? 'opacity-80' : ''
                        }`}
                      >
                        {isSubmitting && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        <span>{submitLabel}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </FormModalValidationContext.Provider>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Automatic Unsaved Changes (Dirty-State) Guard */}
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        title="Discard unsaved changes?"
        description="You have unsaved edits in this form. Closing now will discard all changes."
        caution="Unsaved drafts are not recoverable once discarded."
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        variant="warning"
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          setSubmitConfirmOpen(false);
          setShowHints(false);
          setSubmitAttempted(false);
          onClose();
        }}
        onCancel={() => setDiscardConfirmOpen(false)}
      />

      {/* Automatic Pre-Submit Confirmation */}
      <ConfirmDialog
        isOpen={submitConfirmOpen}
        title={confirmSubmitTitle}
        description={confirmSubmitDescription}
        caution={confirmSubmitCaution}
        impactSummary={confirmSubmitImpact}
        confirmLabel={submitLabel}
        cancelLabel="Review Form"
        variant={confirmSubmitVariant}
        loading={isSubmitting}
        onConfirm={handleConfirmedSubmit}
        onCancel={() => {
          if (!isSubmitting) setSubmitConfirmOpen(false);
        }}
      />
    </>,
    document.body
  );
}

export default FormModal;
