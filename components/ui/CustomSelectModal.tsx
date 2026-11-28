'use client';

import React, { useState, useEffect } from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';
import { useModalLock } from '@/hooks/useModalLock';


export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface CustomSelectModalProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  id?: string;
  testId?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Phase 51-B: Universal Framer Motion Select Component
 * Replaces native HTML <select> elements with an interactive trigger button
 * and a responsive Framer Motion bottom sheet (anchored bottom on mobile, centered on desktop).
 */
export function CustomSelectModal({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  label,
  id,
  testId,
  disabled = false,
  className = '',
}: CustomSelectModalProps) {
  const isMounted = useHydrated();
  const [isOpen, setIsOpen] = useState(false);

  useModalLock(isOpen, () => setIsOpen(false));

  const selectedOption = options.find((opt) => opt.value === value) || null;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelectOption = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className={`w-full ${className}`.trim()}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-semibold text-[var(--ps-text)] mb-1.5"
        >
          {label}
        </label>
      )}

      {/* Interactive Trigger Button mimicking a select input */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        data-testid={testId || 'custom-select-trigger'}
        data-value={value}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={label || placeholder}
        onClick={() => {
          if (!disabled) setIsOpen(true);
        }}
        className="w-full min-h-[44px] flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      >
        <span
          className={`truncate text-left ${
            selectedOption ? 'text-[var(--ps-text)]' : 'text-[var(--ps-text-muted)]'
          }`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--ps-text-muted)] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Pass V13-A: Universal Centered Modal (Portaled to document.body at z-[98], backdrop z-[97]) */}
      {isMounted &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                data-testid={testId ? `${testId}-backdrop` : 'custom-select-backdrop'}
                className="fixed inset-0 z-[97] pointer-events-auto flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label={label || placeholder}
                  data-testid={testId ? `${testId}-modal` : 'custom-select-modal'}
                  initial={{ opacity: 0, y: 16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.96 }}
                  transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                  className="relative z-[98] pointer-events-auto w-full max-w-sm max-h-[80dvh] overflow-y-auto bg-[var(--bg-elevated,var(--ps-surface))] text-[var(--text-primary,var(--ps-text))] rounded-2xl shadow-2xl border border-[var(--border-subtle,var(--ps-border))] flex flex-col"
                >
              {/* Sticky Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shrink-0">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {label || placeholder}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close selection modal"
                  data-testid="custom-select-close-btn"
                  className="min-w-[44px] min-h-[44px] -mr-1.5 inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sleek Radio-Group List */}
              <div
                role="radiogroup"
                aria-label={label || placeholder}
                className="p-3 space-y-1.5 overflow-y-auto"
              >
                {options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-testid={`custom-select-option-${opt.value}`}
                      onClick={() => handleSelectOption(opt.value)}
                      className={`w-full min-h-[44px] flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-bold'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Radio indicator circle */}
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-400 dark:border-slate-600 bg-transparent'
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm truncate">
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-normal">
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

export default CustomSelectModal;
