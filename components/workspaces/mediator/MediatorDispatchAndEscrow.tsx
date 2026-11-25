'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import { supabase } from '@/lib/supabase/client';
import {
  DELIVERY_PODS_BUCKET,
} from '@/lib/supabase/storage';
import {
  formatFleetClassLabel,
  normalizeFleetClassSlug,
  POD_PURGED_POLICY_MESSAGE,
  type MediatorDispatchItem,
  type MediatorDomainFilter,
  type MediatorDriverOption,
  type MediatorEscrowItem,
} from '@/lib/mediator/types';

// =============================================================================
// 1. LIVE DISPATCH & FLEET ASSIGNMENT PANEL
// =============================================================================

export interface MediatorLiveDispatchPanelProps {
  items: MediatorDispatchItem[];
  drivers: MediatorDriverOption[];
  isLoading: boolean;
  busyId: string | null;
  onRefresh: () => void;
  onDispatchDriver: (
    item: MediatorDispatchItem,
    driverId: string,
    reason?: string
  ) => Promise<void>;
}

export function MediatorLiveDispatchPanel({
  items,
  drivers,
  isLoading,
  busyId,
  onRefresh,
  onDispatchDriver,
}: MediatorLiveDispatchPanelProps) {
  const [domainFilter, setDomainFilter] =
    useState<MediatorDomainFilter>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<
    'all' | 'unassigned' | 'assigned'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Assign / Reassign FormModal state
  const [dispatchTarget, setDispatchTarget] =
    useState<MediatorDispatchItem | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [dispatchReason, setDispatchReason] = useState('');
  const [driverTouched, setDriverTouched] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (domainFilter !== 'all' && it.domain !== domainFilter) return false;
      if (assignmentFilter === 'unassigned' && it.driverId) return false;
      if (assignmentFilter === 'assigned' && !it.driverId) return false;
      if (!q) return true;
      return (
        it.code.toLowerCase().includes(q) ||
        it.customerName.toLowerCase().includes(q) ||
        it.pickupAddress.toLowerCase().includes(q) ||
        it.dropoffAddress.toLowerCase().includes(q) ||
        (it.driverName || '').toLowerCase().includes(q)
      );
    });
  }, [items, domainFilter, assignmentFilter, searchQuery]);

  // Filter KYC-verified active drivers strictly matching the booking's 5-tier fleet class
  const matchingDrivers = useMemo(() => {
    if (!dispatchTarget) return [];
    const targetSlug = normalizeFleetClassSlug(dispatchTarget.vehicleClassSlug);
    return drivers
      .filter(
        (d) =>
          d.is_active &&
          (d.kyc_verified || d.kyc_status === 'verified') &&
          normalizeFleetClassSlug(d.vehicle_type) === targetSlug
      )
      .sort((a, b) => Number(b.is_online) - Number(a.is_online));
  }, [drivers, dispatchTarget]);

  const isReassignment = Boolean(
    dispatchTarget?.driverId &&
      selectedDriverId &&
      dispatchTarget.driverId !== selectedDriverId
  );

  const driverError = !selectedDriverId
    ? 'Select an active, KYC-verified driver from the matching fleet class.'
    : null;
  const reasonError =
    isReassignment && dispatchReason.trim().length < 4
      ? 'Provide a brief reason (min 4 characters) when reassigning a driver.'
      : null;
  const validationErrors = [driverError, reasonError].filter(
    (msg): msg is string => Boolean(msg)
  );
  const isFormValid = validationErrors.length === 0;
  const isFormDirty = Boolean(
    (selectedDriverId && selectedDriverId !== (dispatchTarget?.driverId || '')) ||
      dispatchReason.trim().length > 0
  );

  const openDispatchModal = (item: MediatorDispatchItem) => {
    setDispatchTarget(item);
    setSelectedDriverId(item.driverId || '');
    setDispatchReason('');
    setDriverTouched(false);
    setReasonTouched(false);
    setSubmitAttempted(false);
  };

  const closeDispatchModal = () => {
    setDispatchTarget(null);
    setSelectedDriverId('');
    setDispatchReason('');
    setDriverTouched(false);
    setReasonTouched(false);
    setSubmitAttempted(false);
  };

  const selectedDriverObj = matchingDrivers.find(
    (d) => d.id === selectedDriverId
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-[var(--ps-text)]">
              Live Dispatch &amp; Fleet Assignment
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              Assign or reassign KYC-verified drivers to funded Pick N Drop
              orders and confirmed Scheduled Vehicle trips by matching 5-tier
              fleet class.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Fleet</span>
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All Funded (${items.length})` },
                {
                  id: 'unassigned',
                  label: `Awaiting Driver (${items.filter((i) => !i.driverId).length})`,
                },
                {
                  id: 'assigned',
                  label: `Assigned (${items.filter((i) => Boolean(i.driverId)).length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAssignmentFilter(tab.id)}
                className={`inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  assignmentFilter === tab.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <div className="flex items-center gap-1 border-l border-[var(--ps-border)] pl-2">
              {(
                [
                  { id: 'all', label: 'Both' },
                  { id: 'pick_n_drop', label: 'PnD' },
                  { id: 'vehicle_booking', label: 'Vehicles' },
                ] as Array<{ id: MediatorDomainFilter; label: string }>
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDomainFilter(d.id)}
                  className={`inline-flex min-h-[44px] items-center rounded-xl border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                    domainFilter === d.id
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, route, driver..."
              aria-label="Search dispatch jobs"
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="dd-shimmer h-36 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
            />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <Truck className="mx-auto h-9 w-9 text-[var(--ps-text-muted)]" />
          <h3 className="mt-3 text-sm font-bold text-[var(--ps-text)]">
            No Active Dispatch Jobs
          </h3>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Funded Pick N Drop orders and confirmed vehicle bookings awaiting
            pickup or reassignment will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isBusy = busyId === item.id;
            return (
              <div
                key={`${item.domain}-${item.id}`}
                data-testid={`mediator-dispatch-card-${item.code}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)]">
                      {item.domain === 'pick_n_drop' ? (
                        <Package className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      ) : (
                        <Car className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      )}
                      <span>{item.serviceLabel}</span>
                    </span>
                    <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                      {item.code}
                    </span>
                    <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                    ₹{item.fareInr.toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <MapPin className="h-3 w-3 text-emerald-600" />
                      <span>Pickup &amp; Dropoff</span>
                    </div>
                    <p className="text-xs font-semibold text-[var(--ps-text)] line-clamp-1">
                      From: {item.pickupAddress}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-1">
                      To: {item.dropoffAddress}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Required Fleet Class &amp; Customer
                    </div>
                    <div className="text-xs font-bold text-[var(--ps-text)]">
                      {formatFleetClassLabel(item.vehicleClassSlug)}
                    </div>
                    <div className="text-[11px] text-[var(--ps-text-muted)] truncate">
                      {item.customerName}
                      {item.customerPhone ? ` · ${item.customerPhone}` : ''}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Assigned Driver
                    </div>
                    {item.driverId ? (
                      <>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          <UserCheck className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {item.driverName || 'Assigned Driver'}
                          </span>
                        </div>
                        {item.driverPhone && (
                          <div className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ps-text-muted)]">
                            <Phone className="h-3 w-3" />
                            <span>{item.driverPhone}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        Unassigned — Awaiting Driver Dispatch
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-[var(--ps-border)] pt-3">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => openDispatchModal(item)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                  >
                    <Truck className="h-4 w-4" />
                    <span>
                      {item.driverId ? 'Reassign Driver' : 'Assign Driver'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Driver Assignment / Reassignment FormModal */}
      <FormModal
        isOpen={Boolean(dispatchTarget)}
        title={
          dispatchTarget?.driverId
            ? `Reassign Driver (${dispatchTarget.code})`
            : `Assign Driver (${dispatchTarget?.code || ''})`
        }
        subtitle={
          dispatchTarget
            ? `Showing active KYC-verified drivers for ${formatFleetClassLabel(dispatchTarget.vehicleClassSlug)}`
            : undefined
        }
        hints={[
          'Drivers are filtered strictly to the matching 5-tier fleet class and KYC-verified status.',
          'Online drivers are listed first with their verified phone number for coordination.',
        ]}
        cautions={[
          'Dispatching updates the live order status and writes an immutable record to audit_logs.',
        ]}
        isDirty={isFormDirty}
        isValid={isFormValid}
        validationSummary={validationErrors}
        onSubmitAttempt={() => {
          setDriverTouched(true);
          setReasonTouched(true);
          setSubmitAttempted(true);
        }}
        submitLabel={
          dispatchTarget?.driverId ? 'Confirm Reassignment' : 'Dispatch Driver'
        }
        confirmSubmitTitle={
          dispatchTarget?.driverId
            ? 'Confirm Driver Reassignment'
            : 'Confirm Driver Dispatch'
        }
        confirmSubmitDescription={
          selectedDriverObj && dispatchTarget
            ? `Assign ${selectedDriverObj.full_name} (${selectedDriverObj.phone}) to ${dispatchTarget.code}?`
            : 'Confirm assigning the selected driver to this booking?'
        }
        confirmSubmitVariant="info"
        isSubmitting={Boolean(dispatchTarget && busyId === dispatchTarget.id)}
        maxWidthClassName="max-w-xl"
        onSubmit={async () => {
          if (!dispatchTarget || !isFormValid) return;
          await onDispatchDriver(
            dispatchTarget,
            selectedDriverId,
            dispatchReason.trim() || undefined
          );
          closeDispatchModal();
        }}
        onClose={closeDispatchModal}
      >
        {dispatchTarget && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-1">
              <div className="font-bold text-[var(--ps-text)]">
                {dispatchTarget.code} ·{' '}
                {formatFleetClassLabel(dispatchTarget.vehicleClassSlug)}
              </div>
              <p className="text-[var(--ps-text-muted)]">
                {dispatchTarget.pickupAddress} → {dispatchTarget.dropoffAddress}
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-[var(--ps-text)]">
                Select KYC-Verified Driver{' '}
                <span className="text-rose-600">*</span>
              </div>

              {matchingDrivers.length === 0 ? (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
                  No active, KYC-verified drivers are currently registered for{' '}
                  <strong>
                    {formatFleetClassLabel(dispatchTarget.vehicleClassSlug)}
                  </strong>
                  . Verify a driver in Fleet Onboarding before dispatching.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {matchingDrivers.map((drv) => {
                    const isSelected = selectedDriverId === drv.id;
                    return (
                      <button
                        key={drv.id}
                        type="button"
                        onClick={() => {
                          setSelectedDriverId(drv.id);
                          setDriverTouched(true);
                        }}
                        className={`flex w-full min-h-[52px] items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                              {drv.full_name}
                            </span>
                            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                              KYC Verified
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                            <span className="inline-flex items-center gap-1 font-mono">
                              <Phone className="h-3 w-3" />
                              {drv.phone}
                            </span>
                            {drv.vehicle_reg_no && (
                              <span className="font-mono">
                                · {drv.vehicle_reg_no}
                              </span>
                            )}
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold ${
                            drv.is_online
                              ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {drv.is_online ? 'Online' : 'Offline'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {(driverTouched || submitAttempted) && driverError && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {driverError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="mediator-dispatch-reason"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Dispatch / Reassignment Note{' '}
                {isReassignment && <span className="text-rose-600">*</span>}
              </label>
              <textarea
                id="mediator-dispatch-reason"
                rows={2}
                value={dispatchReason}
                onChange={(e) => setDispatchReason(e.target.value)}
                onBlur={() => setReasonTouched(true)}
                placeholder={
                  isReassignment
                    ? 'Required: explain why the previous driver is being replaced...'
                    : 'Optional note for the dispatch audit trail...'
                }
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {(reasonTouched || submitAttempted) && reasonError && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {reasonError}
                </p>
              )}
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}

// =============================================================================
// 2. ESCROW PAYOUTS, POD AUDIT & DISPUTES PANEL
// =============================================================================

export interface MediatorEscrowPayoutsPanelProps {
  items: MediatorEscrowItem[];
  isLoading: boolean;
  nowMs: number;
  busyId: string | null;
  onRefresh: () => void;
  onResolveEscrow: (
    item: MediatorEscrowItem,
    action: 'release_to_driver' | 'freeze_dispute' | 'refund_customer',
    reason: string
  ) => Promise<void>;
}

export function MediatorEscrowPayoutsPanel({
  items,
  isLoading,
  nowMs,
  busyId,
  onRefresh,
  onResolveEscrow,
}: MediatorEscrowPayoutsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'ready_payout' | 'disputed' | 'completed'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Private 48h Signed POD Inspection Modal
  const [podTarget, setPodTarget] = useState<MediatorEscrowItem | null>(null);
  const [podSignedUrl, setPodSignedUrl] = useState<string | null>(null);
  const [podLoading, setPodLoading] = useState(false);
  const [podPurgedOrMissing, setPodPurgedOrMissing] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);

  // Release Payout ConfirmDialog (standard verified-OTP release)
  const [releaseTarget, setReleaseTarget] =
    useState<MediatorEscrowItem | null>(null);

  // Reasoned Action FormModal (freeze_dispute, refund_customer, OR dispute override release)
  const [reasonModalState, setReasonModalState] = useState<{
    item: MediatorEscrowItem;
    action: 'freeze_dispute' | 'refund_customer' | 'release_to_driver';
  } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [reasonSubmitAttempted, setReasonSubmitAttempted] = useState(false);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (
        statusFilter === 'ready_payout' &&
        it.status !== 'delivered_pending_confirm'
      ) {
        return false;
      }
      if (statusFilter === 'disputed' && it.status !== 'disputed') {
        return false;
      }
      if (statusFilter === 'completed' && it.status !== 'completed') {
        return false;
      }
      if (!q) return true;
      return (
        it.code.toLowerCase().includes(q) ||
        it.customerName.toLowerCase().includes(q) ||
        (it.driverName || '').toLowerCase().includes(q) ||
        it.routeSummary.toLowerCase().includes(q)
      );
    });
  }, [items, statusFilter, searchQuery]);

  const handleInspectPod = async (item: MediatorEscrowItem) => {
    setPodTarget(item);
    setPodSignedUrl(null);
    setPodError(null);
    setPodPurgedOrMissing(false);

    const isPurgeExpired =
      item.podPurgeAt !== null && Date.parse(item.podPurgeAt) <= nowMs;

    if (!item.podStoragePath || isPurgeExpired) {
      setPodPurgedOrMissing(true);
      setPodLoading(false);
      return;
    }

    setPodLoading(true);
    try {
      const cleanPath = item.podStoragePath.trim().replace(/^\/+/, '');
      // Strictly 60-second short-lived signed URL for private delivery-pods bucket
      const { data, error } = await supabase.storage
        .from(DELIVERY_PODS_BUCKET)
        .createSignedUrl(cleanPath, 60);

      if (error || !data?.signedUrl) {
        const msg = (error?.message || '').toLowerCase();
        if (msg.includes('not found') || msg.includes('object')) {
          setPodPurgedOrMissing(true);
        } else {
          setPodError(
            error?.message ||
              'Unable to generate a temporary 60-second POD link.'
          );
        }
        return;
      }

      setPodSignedUrl(data.signedUrl);
    } catch (err) {
      setPodError(
        err instanceof Error
          ? err.message
          : 'Unable to inspect private POD image.'
      );
    } finally {
      setPodLoading(false);
    }
  };

  const openReasonModal = (
    item: MediatorEscrowItem,
    action: 'freeze_dispute' | 'refund_customer' | 'release_to_driver'
  ) => {
    setReasonModalState({ item, action });
    setActionReason('');
    setReasonTouched(false);
    setReasonSubmitAttempted(false);
  };

  const closeReasonModal = () => {
    setReasonModalState(null);
    setActionReason('');
    setReasonTouched(false);
    setReasonSubmitAttempted(false);
  };

  const trimmedReason = actionReason.trim();
  const minReasonLen =
    reasonModalState?.action === 'release_to_driver' ? 5 : 4;
  const reasonFieldError =
    trimmedReason.length === 0
      ? 'A clear resolution reason is required.'
      : trimmedReason.length < minReasonLen
        ? `Please enter at least ${minReasonLen} characters for the audit trail.`
        : null;
  const isReasonValid = reasonFieldError === null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-[var(--ps-text)]">
              Escrow Payouts, POD Audit &amp; Disputes
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              Verify handover OTP milestones (boolean status only — raw OTP
              secrets are never exposed), inspect private 48-hour POD photos,
              and settle driver payouts or customer refunds.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Escrow</span>
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${items.length})` },
                {
                  id: 'ready_payout',
                  label: `Ready to Release (${items.filter((i) => i.status === 'delivered_pending_confirm').length})`,
                },
                {
                  id: 'disputed',
                  label: `Disputed (${items.filter((i) => i.status === 'disputed').length})`,
                },
                {
                  id: 'completed',
                  label: `Settled (${items.filter((i) => i.status === 'completed').length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, driver, customer..."
              aria-label="Search escrow records"
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="dd-shimmer h-40 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
            />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <ShieldCheck className="mx-auto h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-sm font-bold text-[var(--ps-text)]">
            No Escrow Settlements Found
          </h3>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Trips in transit, awaiting payout confirmation, or under dispute
            will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isBusy = busyId === item.id;
            const isSettled =
              item.status === 'completed' || item.status === 'cancelled';
            const otpReadyForPayout =
              item.tripType === 'two_way'
                ? (item.otpMilestones.dropoff_verified &&
                    item.otpMilestones.return_verified) ||
                  item.status === 'delivered_pending_confirm'
                : item.otpMilestones.dropoff_verified ||
                  item.status === 'delivered_pending_confirm';

            const canReleaseDirect = !isSettled && otpReadyForPayout;
            const canReleaseOverride =
              !isSettled && !otpReadyForPayout && item.status === 'disputed';

            return (
              <div
                key={`${item.domain}-${item.id}`}
                data-testid={`mediator-escrow-card-${item.code}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5"
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                      {item.code}
                    </span>
                    <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                      {item.domain === 'pick_n_drop'
                        ? item.tripType === 'two_way'
                          ? 'Pick N Drop · Two-Way'
                          : 'Pick N Drop · One-Way'
                        : 'Scheduled Vehicle'}
                    </span>
                    <span
                      className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        item.status === 'disputed'
                          ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                          : item.status === 'completed'
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {item.escrowStateLabel}
                    </span>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                      Escrow ₹{item.fareInr.toLocaleString('en-IN')}
                    </div>
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      Driver Payout ₹
                      {item.payoutAmountInr.toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                {/* OTP Milestone Checklist (Zero Raw OTPs) */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--ps-text)]">
                      <Lock className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>Asymmetric Handover OTP Milestones</span>
                    </span>
                    <span className="text-[10px] text-[var(--ps-text-muted)]">
                      Codes shielded · Boolean verification status only
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                        item.otpMilestones.pickup_verified
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {item.otpMilestones.pickup_verified ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      <span>
                        Pickup OTP:{' '}
                        {item.otpMilestones.pickup_verified
                          ? 'Verified'
                          : 'Pending'}
                      </span>
                    </span>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                        item.otpMilestones.dropoff_verified
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {item.otpMilestones.dropoff_verified ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      <span>
                        Dropoff OTP:{' '}
                        {item.otpMilestones.dropoff_verified
                          ? 'Verified'
                          : 'Pending'}
                      </span>
                    </span>

                    {(item.tripType === 'two_way' ||
                      item.otpMilestones.return_required) && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                          item.otpMilestones.return_verified
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {item.otpMilestones.return_verified ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Clock className="h-3.5 w-3.5" />
                        )}
                        <span>
                          Return OTP:{' '}
                          {item.otpMilestones.return_verified
                            ? 'Verified'
                            : 'Pending'}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Details + Dispute Reason */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                  <div className="text-[var(--ps-text-muted)]">
                    <span className="font-semibold text-[var(--ps-text)]">
                      Customer:
                    </span>{' '}
                    {item.customerName}
                    {item.customerPhone ? ` (${item.customerPhone})` : ''}
                  </div>
                  <div className="text-[var(--ps-text-muted)]">
                    <span className="font-semibold text-[var(--ps-text)]">
                      Driver:
                    </span>{' '}
                    {item.driverName || 'Unassigned'}
                    {item.driverPhone ? ` (${item.driverPhone})` : ''}
                  </div>
                </div>

                {item.disputeReason && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    <span className="font-bold">Dispute Note: </span>
                    {item.disputeReason}
                  </div>
                )}

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-3">
                  <button
                    type="button"
                    onClick={() => void handleInspectPod(item)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                  >
                    <Camera className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Inspect 48h POD</span>
                  </button>

                  {!isSettled && (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.status !== 'disputed' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            openReasonModal(item, 'freeze_dispute')
                          }
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 text-xs font-bold text-amber-800 hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-200 transition-colors cursor-pointer"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          <span>Freeze for Dispute</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openReasonModal(item, 'refund_customer')}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 text-xs font-bold text-rose-700 hover:bg-rose-500/15 disabled:opacity-50 dark:text-rose-300 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span>Approve Refund</span>
                      </button>

                      {canReleaseDirect ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setReleaseTarget(item)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Release Payout</span>
                        </button>
                      ) : canReleaseOverride ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            openReasonModal(item, 'release_to_driver')
                          }
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          <span>Dispute Override Release</span>
                        </button>
                      ) : (
                        <span className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-[11px] font-semibold text-[var(--ps-text-muted)]">
                          Awaiting Dropoff OTP
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Private 48-Hour POD Inspection Modal */}
      {podTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Private Proof of Delivery Inspection"
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                  Private POD Audit · {podTarget.code}
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Private bucket (`delivery-pods`) · Short-lived 60s signed URL
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPodTarget(null);
                  setPodSignedUrl(null);
                }}
                aria-label="Close POD inspection modal"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ps-text-muted)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {podLoading ? (
                <div className="dd-shimmer h-64 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]" />
              ) : podPurgedOrMissing ? (
                <div
                  data-testid="pod-purged-notice"
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center space-y-2"
                >
                  <Lock className="mx-auto h-7 w-7 text-[var(--ps-text-muted)]" />
                  <p className="text-xs font-bold text-[var(--ps-text)]">
                    {POD_PURGED_POLICY_MESSAGE}
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Proof-of-Delivery photos are stored in a private bucket and
                    automatically deleted 48 hours after completion.
                  </p>
                </div>
              ) : podError ? (
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
                  {podError}
                </div>
              ) : podSignedUrl ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={podSignedUrl}
                      alt={`Proof of delivery for ${podTarget.code}`}
                      referrerPolicy="no-referrer"
                      className="max-h-80 w-full object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
                    <span>Temporary signed link expires in 60 seconds.</span>
                    {podTarget.podPurgeAt && (
                      <span>
                        Auto-purge:{' '}
                        {new Date(podTarget.podPurgeAt).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/60 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setPodTarget(null);
                  setPodSignedUrl(null);
                }}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Release Payout Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(releaseTarget)}
        title={`Release Escrow Payout (${releaseTarget?.code || ''})?`}
        description="Handover OTP verification is confirmed. Releasing settles the driver payout and schedules the private POD photo for automatic 48-hour purge."
        caution="Payout settlement is irreversible once recorded on the ledger."
        impactSummary={
          releaseTarget
            ? [
                `Booking: ${releaseTarget.code}`,
                `Driver: ${releaseTarget.driverName || 'Assigned Driver'}`,
                `Driver Payout: ₹${releaseTarget.payoutAmountInr.toLocaleString('en-IN')}`,
                'POD Photo: Auto-purged 48 hours after settlement',
              ]
            : undefined
        }
        confirmLabel="Release Payout"
        cancelLabel="Cancel"
        variant="warning"
        loading={Boolean(releaseTarget && busyId === releaseTarget.id)}
        onConfirm={async () => {
          if (!releaseTarget) return;
          const target = releaseTarget;
          await onResolveEscrow(
            target,
            'release_to_driver',
            'Escrow released upon verified OTP handover'
          );
          setReleaseTarget(null);
        }}
        onCancel={() => setReleaseTarget(null)}
      />

      {/* Freeze Dispute / Approve Refund / Dispute Override Release FormModal */}
      <FormModal
        isOpen={Boolean(reasonModalState)}
        title={
          reasonModalState?.action === 'freeze_dispute'
            ? `Freeze Escrow for Dispute (${reasonModalState.item.code})`
            : reasonModalState?.action === 'refund_customer'
              ? `Approve Customer Refund (${reasonModalState.item.code})`
              : `Dispute Override Payout (${reasonModalState?.item.code || ''})`
        }
        subtitle="A documented reason is mandatory and permanently logged to the Mediator audit trail."
        hints={[
          'Inspect the private 48h POD photo and contact both customer and driver before settling disputed escrows.',
        ]}
        cautions={
          reasonModalState?.action === 'refund_customer'
            ? [
                'Approving a refund cancels the booking and records a refund entry for the customer.',
              ]
            : [
                'Freezing escrow pauses all driver payouts until the dispute is resolved.',
              ]
        }
        isDirty={actionReason.trim().length > 0}
        isValid={isReasonValid}
        validationSummary={reasonFieldError ? [reasonFieldError] : []}
        onSubmitAttempt={() => {
          setReasonTouched(true);
          setReasonSubmitAttempted(true);
        }}
        submitLabel={
          reasonModalState?.action === 'freeze_dispute'
            ? 'Freeze Escrow'
            : reasonModalState?.action === 'refund_customer'
              ? 'Approve Refund'
              : 'Override & Release Payout'
        }
        confirmSubmitTitle={
          reasonModalState?.action === 'freeze_dispute'
            ? 'Confirm Escrow Freeze'
            : reasonModalState?.action === 'refund_customer'
              ? 'Confirm Customer Refund'
              : 'Confirm Dispute Override Payout'
        }
        confirmSubmitDescription={
          reasonModalState
            ? `Apply "${reasonModalState.action.replace(/_/g, ' ')}" on ${reasonModalState.item.code}?`
            : undefined
        }
        confirmSubmitVariant={
          reasonModalState?.action === 'refund_customer' ? 'danger' : 'warning'
        }
        isSubmitting={Boolean(
          reasonModalState && busyId === reasonModalState.item.id
        )}
        maxWidthClassName="max-w-lg"
        onSubmit={async () => {
          if (!reasonModalState || !isReasonValid) return;
          await onResolveEscrow(
            reasonModalState.item,
            reasonModalState.action,
            trimmedReason
          );
          closeReasonModal();
        }}
        onClose={closeReasonModal}
      >
        {reasonModalState && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-1">
              <div className="font-bold text-[var(--ps-text)]">
                {reasonModalState.item.code} · ₹
                {reasonModalState.item.fareInr.toLocaleString('en-IN')}
              </div>
              <p className="text-[var(--ps-text-muted)]">
                {reasonModalState.item.routeSummary}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="mediator-escrow-reason"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Resolution Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="mediator-escrow-reason"
                rows={3}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                onBlur={() => setReasonTouched(true)}
                placeholder="Document evidence, call confirmation, or POD inspection findings..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {(reasonTouched || reasonSubmitAttempted) && reasonFieldError && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {reasonFieldError}
                </p>
              )}
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}
