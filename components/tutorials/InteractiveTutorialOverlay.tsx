'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { createPortal } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  X,
} from 'lucide-react';
import {
  OVERLAY_STATE_EVENT,
  getActiveModalLockCount,
} from '@/hooks/useModalLock';
import {
  markTutorialCompleted,
  markTutorialSkippedForSession,
  resolveTourForPath,
  shouldAutoStartTour,
  TUTORIALS_STATE_CHANGED_EVENT,
  writeTutorialsDisabledPermanently,
  type TutorialTourDefinition,
} from '@/lib/tutorials/tutorial-registry';


interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function hasBlockingModalOpen(): boolean {
  if (typeof document === 'undefined') return true;
  if (getActiveModalLockCount() > 0) return true;
  const activeDialogs = document.querySelectorAll(
    '[role="dialog"][aria-modal="true"]'
  );
  for (const el of Array.from(activeDialogs)) {
    if (el.getAttribute('data-testid') === 'interactive-tutorial-overlay') {
      continue;
    }
    return true;
  }
  return false;
}

function measureTarget(selector: string): RectBox | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }
  try {
    const el = document.querySelector(selector);
    if (!el || !(el instanceof HTMLElement)) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return null;
    // Ignore targets completely outside viewport vertically
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      return null;
    }
    const pad = 6;
    return {
      top: Math.max(4, rect.top - pad),
      left: Math.max(4, rect.left - pad),
      width: Math.min(window.innerWidth - 8, rect.width + pad * 2),
      height: Math.min(window.innerHeight - 8, rect.height + pad * 2),
    };
  } catch {
    return null;
  }
}

function TutorialSearchSync({
  onChange,
}: {
  onChange: (searchStr: string) => void;
}) {
  const searchParams = useSearchParams();
  const str = searchParams?.toString() || '';
  useEffect(() => {
    onChange(str);
  }, [str, onChange]);
  return null;
}

export function InteractiveTutorialOverlay() {
  const pathname = usePathname() || '/';
  const [searchStr, setSearchStr] = useState<string>('');
  const mounted = useHydrated();

  const [activeTour, setActiveTour] = useState<TutorialTourDefinition | null>(
    null
  );
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [targetRect, setTargetRect] = useState<RectBox | null>(null);
  const [recheckToken, setRecheckToken] = useState<number>(0);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<{ width: number; height: number }>({
    width: 340,
    height: 224,
  });
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>({
    width: 390,
    height: 844,
  });

  const currentStep = useMemo(() => {
    if (!activeTour) return null;
    return activeTour.steps[stepIndex] || null;
  }, [activeTour, stepIndex]);

  // Listen to modal close or tutorial reset events to re-evaluate auto-start
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleEvent = () => {
      setRecheckToken((n) => n + 1);
    };
    window.addEventListener(OVERLAY_STATE_EVENT, handleEvent);
    window.addEventListener(TUTORIALS_STATE_CHANGED_EVENT, handleEvent);
    return () => {
      window.removeEventListener(OVERLAY_STATE_EVENT, handleEvent);
      window.removeEventListener(TUTORIALS_STATE_CHANGED_EVENT, handleEvent);
    };
  }, []);

  // Auto-trigger tour on route entry ONLY if first visit & zero blocking modals are open
  useEffect(() => {
    if (!mounted) return;
    const tour = resolveTourForPath(pathname, searchStr);

    if (!tour || !shouldAutoStartTour(tour.id)) {
      queueMicrotask(() => {
        setActiveTour((prev) => (prev?.id === tour?.id ? prev : null));
      });
      return;
    }

    // Already displaying this exact tour
    if (activeTour?.id === tour.id) return;

    const timer = window.setTimeout(() => {
      if (!shouldAutoStartTour(tour.id)) return;
      if (hasBlockingModalOpen()) return;
      setActiveTour(tour);
      setStepIndex(0);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [mounted, pathname, searchStr, recheckToken, activeTour?.id]);

  // Dismiss gracefully if another blocking modal opens while tutorial is visible
  useEffect(() => {
    if (!activeTour) return;
    if (hasBlockingModalOpen()) {
      queueMicrotask(() => {
        setActiveTour(null);
      });
    }
  }, [activeTour, recheckToken]);

  // Measure target element & viewport geometry on resize/scroll
  useEffect(() => {
    if (!activeTour || !currentStep || typeof window === 'undefined') {
      queueMicrotask(() => setTargetRect(null));
      return;
    }

    const syncViewportAndTarget = () => {
      const vw = window.innerWidth;
      const vh = Math.round(window.visualViewport?.height || window.innerHeight);
      setViewportSize((prev) =>
        prev.width === vw && prev.height === vh ? prev : { width: vw, height: vh }
      );
      setTargetRect(measureTarget(currentStep.targetSelector));
    };

    const syncRectWithScroll = () => {
      const el = document.querySelector(currentStep.targetSelector);
      if (el instanceof HTMLElement) {
        const raw = el.getBoundingClientRect();
        if (raw.top < 56 || raw.bottom > window.innerHeight - 96) {
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch {
            // Ignore scrollIntoView errors
          }
        }
      }
      syncViewportAndTarget();
    };

    syncViewportAndTarget();
    const initialTimer = window.setTimeout(syncRectWithScroll, 120);

    window.addEventListener('resize', syncViewportAndTarget);
    window.addEventListener('scroll', syncViewportAndTarget, { passive: true });
    window.visualViewport?.addEventListener('resize', syncViewportAndTarget);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener('resize', syncViewportAndTarget);
      window.removeEventListener('scroll', syncViewportAndTarget);
      window.visualViewport?.removeEventListener('resize', syncViewportAndTarget);
    };
  }, [activeTour, currentStep]);

  // Measure rendered tooltip card dimensions via ResizeObserver for strict viewport clamping
  useEffect(() => {
    if (!activeTour || !currentStep) return;
    const node = cardRef.current;
    if (!node) return;

    const measureCard = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextW = Math.round(rect.width);
        const nextH = Math.round(rect.height);
        setCardSize((prev) =>
          Math.abs(prev.width - nextW) <= 1 && Math.abs(prev.height - nextH) <= 1
            ? prev
            : { width: nextW, height: nextH }
        );
      }
    };

    measureCard();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureCard);
    ro.observe(node);
    return () => ro.disconnect();
  }, [activeTour, currentStep, stepIndex]);

  const handleFinish = useCallback(() => {
    if (activeTour) {
      markTutorialCompleted(activeTour.id);
    }
    setActiveTour(null);
    setStepIndex(0);
  }, [activeTour]);

  const handleSkipForNow = useCallback(() => {
    if (activeTour) {
      markTutorialSkippedForSession(activeTour.id);
    }
    setActiveTour(null);
    setStepIndex(0);
  }, [activeTour]);

  const handleDisableForever = useCallback(() => {
    writeTutorialsDisabledPermanently(true);
    setActiveTour(null);
    setStepIndex(0);
  }, []);

  const handleNext = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex + 1 >= activeTour.steps.length) {
      handleFinish();
    } else {
      setStepIndex((idx) => idx + 1);
    }
  }, [activeTour, stepIndex, handleFinish]);

  const handleBack = useCallback(() => {
    setStepIndex((idx) => Math.max(0, idx - 1));
  }, []);

  // Escape key temporarily skips current tour
  useEffect(() => {
    if (!activeTour) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        handleSkipForNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTour, handleSkipForNow]);

  // Pass V8: Zero-overflow mobile (< 640px) & desktop (>= 640px) tooltip positioning
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    const vw =
      viewportSize.width ||
      (typeof window !== 'undefined' ? window.innerWidth : 390);
    const vh =
      viewportSize.height ||
      (typeof window !== 'undefined'
        ? Math.round(window.visualViewport?.height || window.innerHeight)
        : 844);
    const cardH = Math.min(cardSize.height || 224, vh - 24);
    const gap = 12;

    // Mobile (< 640px): ALWAYS horizontally pin with safe 12px margins & maxWidth 380px
    if (vw < 640) {
      let desiredTop = Math.round((vh - cardH) / 2);
      if (targetRect) {
        const spaceBelow = vh - (targetRect.top + targetRect.height);
        const spaceAbove = targetRect.top;
        desiredTop =
          spaceBelow >= spaceAbove
            ? targetRect.top + targetRect.height + gap
            : targetRect.top - cardH - gap;
      }
      const maxTop = Math.max(12, vh - cardH - 12);
      const clampedTop = Math.max(12, Math.min(maxTop, Math.round(desiredTop)));

      return {
        left: 12,
        right: 12,
        top: clampedTop,
        width: 'calc(100vw - 24px)',
        maxWidth: 380,
        marginInline: 'auto',
      };
    }

    // Desktop (>= 640px): Measure rendered card & strictly clamp inside [16, vw - cardW - 16] and [16, vh - cardH - 16]
    const cardW = Math.min(cardSize.width || 356, vw - 32, 380);
    let desiredLeft = Math.round((vw - cardW) / 2);
    let desiredTop = Math.round((vh - cardH) / 2);

    if (targetRect) {
      desiredLeft = Math.round(
        targetRect.left + targetRect.width / 2 - cardW / 2
      );
      const spaceBelow = vh - (targetRect.top + targetRect.height);
      const spaceAbove = targetRect.top;
      if (spaceBelow >= cardH + gap || spaceBelow >= spaceAbove) {
        desiredTop = Math.round(targetRect.top + targetRect.height + gap);
      } else {
        desiredTop = Math.round(targetRect.top - cardH - gap);
      }
    }

    const clampedLeft = Math.max(
      16,
      Math.min(desiredLeft, Math.max(16, vw - cardW - 16))
    );
    const clampedTop = Math.max(
      16,
      Math.min(desiredTop, Math.max(16, vh - cardH - 16))
    );

    return {
      left: clampedLeft,
      top: clampedTop,
      width: cardW,
      maxWidth: 380,
    };
  }, [targetRect, viewportSize, cardSize]);

  const portalContent =
    mounted && typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>
      {activeTour && currentStep && (
        <div
          data-testid="interactive-tutorial-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeTour.label} quick guide`}
          className="fixed inset-0 z-[88] pointer-events-auto"
        >
          {/* Dimmed backdrop when no target rect, or spotlight shadow ring around target */}
          {targetRect ? (
            <motion.div
              key={`spotlight-${currentStep.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={handleSkipForNow}
              style={{
                position: 'fixed',
                top: targetRect.top,
                left: targetRect.left,
                width: targetRect.width,
                height: targetRect.height,
                boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.58)',
              }}
              className="rounded-2xl ring-2 ring-theme-primary pointer-events-none transition-all duration-200"
            />
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={handleSkipForNow}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            />
          )}

          {/* Click-catcher backdrop so tapping outside skips for now */}
          {targetRect && (
            <div
              onClick={handleSkipForNow}
              className="fixed inset-0 bg-transparent"
              aria-hidden="true"
            />
          )}

          {/* Floating Themed Tooltip Popover (Zero Horizontal or Vertical Overflow) */}
          <motion.div
            ref={cardRef}
            key={`card-${activeTour.id}-${stepIndex}`}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            style={popoverStyle}
            onClick={(e) => e.stopPropagation()}
            data-testid="interactive-tutorial-popover"
            className="fixed z-10 max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-4 py-2.5">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-theme-primary min-w-0">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {activeTour.label} · Step {stepIndex + 1} of{' '}
                  {activeTour.steps.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSkipForNow}
                aria-label="Close tutorial"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3.5 space-y-2">
              <h3 className="text-sm font-extrabold text-[var(--ps-text)] leading-snug break-words">
                {currentStep.title}
              </h3>
              <p className="text-xs leading-relaxed text-[var(--ps-text-muted)] break-words">
                {currentStep.description}
              </p>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 pt-1">
                {activeTour.steps.map((s, idx) => (
                  <span
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === stepIndex
                        ? 'w-5 bg-theme-primary'
                        : idx < stepIndex
                          ? 'w-2 bg-theme-primary/55'
                          : 'w-2 bg-[var(--ps-border)]'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Footer Controls */}
            <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/60 px-4 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleSkipForNow}
                  data-testid="tutorial-skip-btn"
                  className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
                >
                  Skip for now
                </button>

                <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                  {stepIndex > 0 && (
                    <button
                      type="button"
                      onClick={handleBack}
                      data-testid="tutorial-back-btn"
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Back</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleNext}
                    data-testid="tutorial-next-btn"
                    className="inline-flex h-8 items-center gap-1 rounded-xl bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    {stepIndex + 1 >= activeTour.steps.length ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Done</span>
                      </>
                    ) : (
                      <>
                        <span>Next</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap justify-between items-center gap-2">
                <button
                  type="button"
                  onClick={handleDisableForever}
                  data-testid="tutorial-disable-forever-btn"
                  className="text-[10px] font-medium text-[var(--ps-text-muted)] underline decoration-dotted hover:text-[var(--ps-text)] transition-colors cursor-pointer"
                >
                  Don&apos;t show tutorials again
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
        )
      : null;

  return (
    <>
      <Suspense fallback={null}>
        <TutorialSearchSync onChange={setSearchStr} />
      </Suspense>
      {portalContent}
    </>
  );
}

export default InteractiveTutorialOverlay;
