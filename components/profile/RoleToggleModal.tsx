'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Eye, Loader2, Shield, X } from 'lucide-react';
import { useAppStatus } from '@/lib/hooks/useAppStatus';

export interface RoleOptionItem {
  value: string;
  label: string;
  description: string;
}

export interface RoleToggleModalProps {
  open: boolean;
  onClose: () => void;
  currentViewAsRole: string;
  realRole: string;
}

function RoleToggleDialogBody({
  onClose,
  currentViewAsRole,
  realRole,
}: Omit<RoleToggleModalProps, 'open'>) {
  const normalizedReal = realRole.trim().toLowerCase() || 'super_admin';
  const normalizedCurrent =
    currentViewAsRole.trim().toLowerCase() || 'actual';

  const [selectedRole, setSelectedRole] = useState<string>(normalizedCurrent);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setStatus } = useAppStatus();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !isSubmitting) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose]);

  const isSuperAdmin = normalizedReal === 'super_admin';
  const isAdmin = normalizedReal === 'admin';
  const isOwner = normalizedReal === 'owner';

  const roleOptions: RoleOptionItem[] = [
    ...(isSuperAdmin
      ? [
          {
            value: 'actual',
            label: 'Super Admin (Actual)',
            description:
              'Use your real platform super admin permissions and governance controls',
          },
          {
            value: 'owner',
            label: 'Owner',
            description:
              'Preview owner workspace, listings CRUD, and staff tools',
          },
          {
            value: 'staff',
            label: 'Staff',
            description:
              'Preview delegated staff agent view and scoped edits',
          },
          {
            value: 'visitor',
            label: 'Visitor',
            description:
              'Preview standard consumer access without admin routes',
          },
        ]
      : isAdmin
        ? [
            {
              value: 'actual',
              label: 'Admin (Actual)',
              description:
                'Use your real admin moderation and platform operations permissions',
            },
            {
              value: 'owner',
              label: 'Owner',
              description:
                'Preview owner workspace, listings CRUD, and staff tools',
            },
            {
              value: 'staff',
              label: 'Staff',
              description:
                'Preview delegated staff agent view and scoped edits',
            },
            {
              value: 'visitor',
              label: 'Visitor',
              description:
                'Preview standard consumer access without admin routes',
            },
          ]
        : isOwner
          ? [
              {
                value: 'actual',
                label: 'Owner (Actual)',
                description:
                  'Use your real business owner workspace and listing CRUD rights',
              },
              {
                value: 'staff',
                label: 'Staff',
                description:
                  'Preview delegated staff agent view and scoped edits',
              },
              {
                value: 'visitor',
                label: 'Visitor',
                description:
                  'Preview standard consumer access without workspace routes',
              },
            ]
          : [
              {
                value: 'actual',
                label: 'Visitor (Actual)',
                description: 'Standard visitor access',
              },
            ]),
  ];

  const handleSelectOption = async (roleValue: string) => {
    if (isSubmitting) return;
    setSelectedRole(roleValue);
    setErrorMsg(null);
    setIsSubmitting(true);
    setStatus('switching_role');

    try {
      const rolePayload =
        roleValue === 'actual' || !roleValue ? null : roleValue;
      const res = await fetch('/api/auth/set-view-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: rolePayload }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || 'Failed to update role override.');
      }

      setStatus('success');
      window.location.reload();
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to switch active role.'
      );
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      key="role-toggle-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="role-toggle-modal-backdrop"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        key="role-toggle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-toggle-modal-title"
        data-testid="role-toggle-modal"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[calc(100vw-32px)] max-w-md max-h-[85dvh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 touch-pan-y text-[var(--ps-text)]"
      >
        {/* Header */}
        <div className="shrink-0 sticky top-0 z-10 bg-white dark:bg-slate-900 flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-xs">
              <Shield className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2
                id="role-toggle-modal-title"
                className="text-base font-bold text-[var(--ps-text)] truncate"
              >
                View Application As
              </h2>
              <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                Switch effective perspective without signing out
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close role toggle modal"
            data-testid="role-toggle-close-btn"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Custom Radio Group List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400"
            >
              {errorMsg}
            </div>
          )}

          <div
            role="radiogroup"
            aria-label="Select application role perspective"
            className="space-y-2"
          >
            {roleOptions.map((opt) => {
              const isSelected = selectedRole === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={isSubmitting}
                  data-testid={`role-toggle-option-${opt.value}`}
                  onClick={() => void handleSelectOption(opt.value)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer disabled:cursor-wait ${
                    isSelected
                      ? 'border-purple-600 bg-purple-50/80 dark:bg-purple-950/40 ring-1 ring-purple-600/40'
                      : 'border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] hover:border-purple-400 dark:hover:border-purple-700'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isSelected
                          ? 'border-purple-600 bg-purple-600 text-white'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--ps-text)]">
                          {opt.label}
                        </span>
                        {opt.value !== 'actual' && isSelected && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-600/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300">
                            <Eye className="h-2.5 w-2.5" />
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                        {opt.description}
                      </p>
                    </div>
                  </div>

                  {isSubmitting && isSelected && (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-purple-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function RoleToggleModal({
  open,
  onClose,
  currentViewAsRole,
  realRole,
}: RoleToggleModalProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <RoleToggleDialogBody
          onClose={onClose}
          currentViewAsRole={currentViewAsRole}
          realRole={realRole}
        />
      )}
    </AnimatePresence>,
    document.body
  );
}
