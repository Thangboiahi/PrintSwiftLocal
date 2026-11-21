'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface ArchiveBusinessModalProps {
  open: boolean;
  listingId: string;
  listingTitle: string;
  currentLifecycleStatus?: string | null;
  onClose: () => void;
  onLifecycleUpdated?: (newStatus: string) => void;
}

interface ArchiveRpcResult {
  lifecycle_status?: string;
  status?: string;
  message?: string;
  blocking_counts?: Record<string, number>;
  in_flight_orders?: number;
  in_flight_bookings?: number;
  unsettled_escrows?: number;
}

export function ArchiveBusinessModal({
  open,
  listingId,
  listingTitle,
  currentLifecycleStatus,
  onClose,
  onLifecycleUpdated,
}: ArchiveBusinessModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ArchiveRpcResult | null>(null);

  if (!open || typeof document === 'undefined') return null;

  const handleConfirmArchive = async () => {
    if (!isSupabaseConfigured()) {
      setErrorMsg('Supabase is not configured in this environment.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    setAppStatus('saving', 'Updating business lifecycle…');
    try {
      const { data, error } = await supabase.rpc('archive_business_listing', {
        p_listing_id: listingId,
        p_reason: reason.trim() || 'Archived by business owner',
      });
      if (error) {
        throw new Error(error.message || 'Unable to archive listing.');
      }
      const parsed = (
        data && typeof data === 'object' ? data : {}
      ) as ArchiveRpcResult;
      const nextStatus =
        parsed.lifecycle_status || parsed.status || 'archived_by_owner';
      setResult({ ...parsed, lifecycle_status: nextStatus });
      setAppStatus(
        'success',
        nextStatus === 'draining'
          ? 'Listing moved to Draining mode'
          : 'Listing archived safely'
      );
      onLifecycleUpdated?.(nextStatus);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to archive listing.';
      setErrorMsg(msg);
      setAppStatus('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDrainingResult = result?.lifecycle_status === 'draining';
  const blockingEntries = result?.blocking_counts
    ? Object.entries(result.blocking_counts).filter(([, v]) => Number(v) > 0)
    : [
        ...(result?.in_flight_orders
          ? [['In-Flight Orders', result.in_flight_orders] as [string, number]]
          : []),
        ...(result?.in_flight_bookings
          ? [
              ['Active Bookings', result.in_flight_bookings] as [
                string,
                number,
              ],
            ]
          : []),
        ...(result?.unsettled_escrows
          ? [
              ['Unsettled Escrows', result.unsettled_escrows] as [
                string,
                number,
              ],
            ]
          : []),
      ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pause or archive business"
      data-testid="archive-business-modal"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl overflow-hidden text-xs">
        <div className="px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-sm text-[var(--ps-text)]">
            <Archive className="w-4 h-4 text-rose-500 shrink-0" />
            <span>Pause / Archive Business</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          {!result ? (
            <>
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 flex items-start gap-2.5 text-amber-950 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">
                    Safe Lifecycle Closure for &ldquo;{listingTitle}&rdquo;
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Current status:{' '}
                    <strong className="uppercase">
                      {currentLifecycleStatus || 'active'}
                    </strong>
                    . If any orders, bookings, or escrow payouts are still in flight, DD oodle will automatically switch this listing to{' '}
                    <strong>Draining</strong> mode (hidden from public discovery until existing orders complete). Otherwise it will archive cleanly with a 14-day media grace period.
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="archive-business-reason"
                  className="block text-[11px] font-semibold text-[var(--ps-text)]"
                >
                  Reason for closing / pausing (optional)
                </label>
                <textarea
                  id="archive-business-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Seasonal closure, renovating shop, temporarily relocated…"
                  className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300 font-medium">
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmArchive()}
                  disabled={isSubmitting}
                  data-testid="confirm-archive-business-btn"
                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Archive className="w-3.5 h-3.5" />
                  )}
                  <span>Confirm Safe Archive</span>
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div
                className={`rounded-xl border p-3.5 flex items-start gap-2.5 ${
                  isDrainingResult
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200'
                }`}
              >
                {isDrainingResult ? (
                  <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-bold text-sm">
                    {isDrainingResult
                      ? 'Moved to Draining Mode'
                      : 'Business Archived Safely'}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isDrainingResult
                      ? 'This business is now hidden from public map and search discovery while existing in-flight orders/bookings finish.'
                      : 'Staff assignments have been suspended & notified, storefront items deactivated, and media queued for a 14-day grace purge.'}
                  </p>
                </div>
              </div>

              {blockingEntries.length > 0 && (
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-amber-500" />
                    <span>Active Items Keeping Listing in Draining Mode</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {blockingEntries.map(([label, count]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5 flex items-center justify-between"
                      >
                        <span className="text-[11px] text-[var(--ps-text-muted)] capitalize">
                          {label.replace(/_/g, ' ')}
                        </span>
                        <span className="font-extrabold text-xs text-[var(--ps-text)] tabular-nums">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ArchiveBusinessModal;
