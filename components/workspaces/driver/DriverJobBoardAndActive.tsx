'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  IndianRupee,
  KeyRound,
  MapPin,
  Navigation,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
  Undo2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import {
  buildSafeGoogleMapsRouteUrl,
  formatDriverFleetLabel,
  formatInr,
  formatServiceModeLabel,
  getNextHandoverStage,
  type DriverActiveOrderRow,
  type DriverAvailableJobRow,
  type DriverOtpMilestone,
  type DriverPayoutSummary,
  type DriverProfileRow,
  type HandoverTarget,
} from '@/lib/driver/types';

function renderServiceIcon(mode: string) {
  if (mode === 'gas') return <Flame className="h-4 w-4 text-amber-500" />;
  if (mode === 'passenger') return <UserCheck className="h-4 w-4 text-sky-500" />;
  return <Package className="h-4 w-4 text-[var(--ps-accent)]" />;
}

export interface DriverOverviewAndActiveProps {
  driver: DriverProfileRow | null;
  activeOrders: DriverActiveOrderRow[];
  milestones: Record<string, DriverOtpMilestone>;
  payoutSummary: DriverPayoutSummary | null;
  availableCount: number;
  loading: boolean;
  onRefresh: () => void;
  onOpenHandover: (target: HandoverTarget) => void;
  onUpdateTripStatus: (
    bookingId: string,
    status: 'arrived_pickup' | 'en_route_dropoff' | 'driver_cancelled',
    reason?: string
  ) => Promise<void>;
  onJumpToBoard: () => void;
}

export function DriverOverviewAndActive({
  driver,
  activeOrders,
  milestones,
  payoutSummary,
  availableCount,
  loading,
  onRefresh,
  onOpenHandover,
  onUpdateTripStatus,
  onJumpToBoard,
}: DriverOverviewAndActiveProps) {
  const [statusConfirm, setStatusConfirm] = useState<{
    order: DriverActiveOrderRow;
    nextStatus: 'arrived_pickup' | 'en_route_dropoff';
    label: string;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const [releaseOrder, setReleaseOrder] = useState<DriverActiveOrderRow | null>(
    null
  );
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseTouched, setReleaseTouched] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const releaseReasonError = useMemo(() => {
    const trimmed = releaseReason.trim();
    if (!trimmed) return 'Provide a clear reason before releasing this trip.';
    if (trimmed.length < 5) return 'Reason must be at least 5 characters.';
    return null;
  }, [releaseReason]);

  const handleConfirmIntermediateStatus = async () => {
    if (!statusConfirm) return;
    setStatusBusy(true);
    try {
      await onUpdateTripStatus(statusConfirm.order.id, statusConfirm.nextStatus);
      setStatusConfirm(null);
    } finally {
      setStatusBusy(false);
    }
  };

  const handleConfirmReleaseTrip = async () => {
    if (!releaseOrder) return;
    setReleaseBusy(true);
    try {
      await onUpdateTripStatus(
        releaseOrder.id,
        'driver_cancelled',
        releaseReason.trim()
      );
      setReleaseOrder(null);
      setReleaseReason('');
      setReleaseTouched(false);
    } finally {
      setReleaseBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-24 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 dd-shimmer"
            />
          ))}
        </div>
        <div className="h-64 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Live KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Today&apos;s Released</span>
            <IndianRupee className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
            {formatInr(payoutSummary?.released_today_inr ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Settled to driver today
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Escrow Held</span>
            <Wallet className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
            {formatInr(payoutSummary?.escrow_held_inr ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Awaiting handover / release
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Completed Trips</span>
            <CheckCircle2 className="h-4 w-4 text-[var(--ps-accent)]" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
            {payoutSummary?.completed_trips_count ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Verified OTP handovers
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Fleet Tier</span>
            <Bike className="h-4 w-4 text-[var(--ps-accent)]" />
          </div>
          <p className="mt-2 truncate text-base font-extrabold text-[var(--ps-text)]">
            {driver ? formatDriverFleetLabel(driver.vehicle_type) : 'Unregistered'}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold">
            {driver?.is_online ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Online · Accepting Jobs
              </span>
            ) : (
              <span className="text-[var(--ps-text-muted)]">
                Offline · Standby
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Prominent Active Trip Execution Section */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
          <div>
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Active Trip Execution
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Follow the live route, confirm milestones, and verify OTP handovers securely.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {activeOrders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]/60 p-6 text-center space-y-3">
            <Truck className="mx-auto h-9 w-9 text-[var(--ps-text-muted)] opacity-60" />
            <div>
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No active trip right now
              </p>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                {availableCount > 0
                  ? `${availableCount} escrow-funded job${availableCount === 1 ? '' : 's'} matching your fleet tier are ready on the Job Board.`
                  : 'Stay Online so funded Pick N Drop orders matching your fleet tier appear here.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onJumpToBoard}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
            >
              <span>Open Available Job Board ({availableCount})</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {activeOrders.map((order) => {
              const ms = milestones[order.id];
              const nextStage = getNextHandoverStage(order, ms);
              const isTwoWay =
                order.trip_type === 'two_way' || Boolean(ms?.return_required);
              const pickupDone =
                Boolean(ms?.pickup_verified) ||
                [
                  'picked_up',
                  'in_transit',
                  'return_in_transit',
                  'delivered_pending_confirm',
                ].includes(order.status);
              const dropoffDone =
                Boolean(ms?.dropoff_verified) ||
                order.status === 'return_in_transit' ||
                order.status === 'delivered_pending_confirm';
              const returnDone =
                Boolean(ms?.return_verified) ||
                (isTwoWay && order.status === 'delivered_pending_confirm');

              const mapsUrl = buildSafeGoogleMapsRouteUrl({
                originLat: order.pickup_lat,
                originLng: order.pickup_lng,
                originAddress: order.pickup_address,
                destLat: order.dropoff_lat,
                destLng: order.dropoff_lng,
                destAddress: order.dropoff_address,
              });

              const estimatedPayout = Math.round(order.quoted_fare_inr * 0.85);
              const podRequired =
                order.pod_required !== null
                  ? order.pod_required
                  : order.service_mode !== 'passenger';

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/60 p-4 space-y-4"
                >
                  {/* Trip Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]">
                        {renderServiceIcon(order.service_mode)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                            {order.order_code}
                          </span>
                          <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                            {formatServiceModeLabel(order.service_mode)}
                          </span>
                          {isTwoWay && (
                            <span className="rounded-full border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                              2-Way Return
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                          {order.distance_km} km · Est. Driver Payout{' '}
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formatInr(estimatedPayout)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-accent)] bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-colors"
                    >
                      <Navigation className="h-4 w-4 shrink-0" />
                      <span>Open in Google Maps</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </div>

                  {/* Point A -> Point B Route Card */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        <MapPin className="h-3.5 w-3.5" />
                        Point A · Pickup
                      </div>
                      <p className="mt-1 text-xs font-medium text-[var(--ps-text)] leading-relaxed">
                        {order.pickup_address}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        <MapPin className="h-3.5 w-3.5" />
                        Point B · Dropoff
                      </div>
                      <p className="mt-1 text-xs font-medium text-[var(--ps-text)] leading-relaxed">
                        {order.dropoff_address}
                      </p>
                    </div>
                  </div>

                  {order.notes && (
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5 text-xs text-[var(--ps-text-muted)]">
                      <span className="font-bold text-[var(--ps-text)]">
                        Trip Note:{' '}
                      </span>
                      {order.notes}
                    </div>
                  )}

                  {/* Live Zero-Secret OTP Milestone Stepper */}
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <span>OTP Handover Milestones</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                        <ShieldCheck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                        Zero-Trust Verified
                      </span>
                    </div>
                    <div
                      className={`grid gap-2 ${
                        isTwoWay ? 'grid-cols-3' : 'grid-cols-2'
                      }`}
                    >
                      {[
                        {
                          key: 'pickup',
                          label: '1. Pickup OTP',
                          done: pickupDone,
                          active: nextStage === 'pickup',
                        },
                        {
                          key: 'dropoff',
                          label: podRequired
                            ? '2. Dropoff + POD'
                            : '2. Dropoff OTP',
                          done: dropoffDone,
                          active: nextStage === 'dropoff',
                        },
                        ...(isTwoWay
                          ? [
                              {
                                key: 'return',
                                label: '3. Return OTP',
                                done: returnDone,
                                active: nextStage === 'return',
                              },
                            ]
                          : []),
                      ].map((step) => (
                        <div
                          key={step.key}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                            step.done
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : step.active
                                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 text-[var(--ps-accent)]'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {step.done ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate">{step.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Primary & Intermediate Trip Action Bar (44px+ touch targets) */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {order.status === 'driver_assigned' &&
                        order.driver_substatus !== 'arrived_pickup' && (
                          <button
                            type="button"
                            onClick={() =>
                              setStatusConfirm({
                                order,
                                nextStatus: 'arrived_pickup',
                                label: 'Mark Arrived at Pickup',
                              })
                            }
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                          >
                            <MapPin className="h-4 w-4 text-[var(--ps-accent)]" />
                            <span>Arrived at Pickup</span>
                          </button>
                        )}

                      {order.status === 'driver_assigned' &&
                        order.driver_substatus === 'arrived_pickup' && (
                          <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" />
                            At Pickup Point
                          </span>
                        )}

                      {order.status === 'picked_up' && (
                        <button
                          type="button"
                          onClick={() =>
                            setStatusConfirm({
                              order,
                              nextStatus: 'en_route_dropoff',
                              label: 'Mark En Route to Dropoff',
                            })
                          }
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                        >
                          <Navigation className="h-4 w-4 text-[var(--ps-accent)]" />
                          <span>Start En Route to Dropoff</span>
                        </button>
                      )}

                      {order.status === 'driver_assigned' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReleaseOrder(order);
                            setReleaseReason('');
                            setReleaseTouched(false);
                          }}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/8 px-3.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                        >
                          <Undo2 className="h-4 w-4" />
                          <span>Release to Pool</span>
                        </button>
                      )}
                    </div>

                    {nextStage ? (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenHandover({
                            bookingId: order.id,
                            domain: 'pick_n_drop',
                            code: order.order_code,
                            stage: nextStage,
                            podRequired,
                            originLabel: order.pickup_address,
                            destinationLabel: order.dropoff_address,
                          })
                        }
                        className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                      >
                        <KeyRound className="h-4 w-4" />
                        <span>
                          {nextStage === 'pickup'
                            ? 'Verify Pickup OTP'
                            : nextStage === 'dropoff'
                              ? podRequired
                                ? 'Verify Dropoff OTP & POD'
                                : 'Verify Dropoff OTP'
                              : 'Verify Return OTP'}
                        </span>
                      </button>
                    ) : (
                      <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/12 px-4 text-xs font-bold text-amber-800 dark:text-amber-200">
                        <Clock className="h-4 w-4" />
                        Handover Complete · Awaiting Mediator Payout Release
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ConfirmDialog for Non-OTP Intermediate Transitions */}
      <ConfirmDialog
        isOpen={Boolean(statusConfirm)}
        title={statusConfirm?.label || 'Update Trip Status'}
        description={
          statusConfirm
            ? `Update ${statusConfirm.order.order_code} to "${statusConfirm.label}"?`
            : undefined
        }
        impactSummary={
          statusConfirm
            ? [
                `Order: ${statusConfirm.order.order_code}`,
                'Logs timestamped milestone to the trip timeline.',
              ]
            : undefined
        }
        confirmLabel="Confirm Update"
        loading={statusBusy}
        onConfirm={handleConfirmIntermediateStatus}
        onCancel={() => {
          if (!statusBusy) setStatusConfirm(null);
        }}
      />

      {/* FormModal for Reasoned Release Back to Dispatch Pool */}
      <FormModal
        isOpen={Boolean(releaseOrder)}
        title={
          releaseOrder
            ? `Release ${releaseOrder.order_code} Back to Dispatch Pool`
            : 'Release Assigned Trip'
        }
        subtitle="Only allowed before Pickup OTP verification. Escrow remains safely funded for the next driver."
        cautions={[
          'Frequent unexcused cancellations are audited by Hub Mediators.',
          'Once released, another verified driver can immediately accept this funded job.',
        ]}
        isDirty={releaseReason.trim().length > 0}
        isValid={!releaseReasonError}
        validationSummary={releaseReasonError ? [releaseReasonError] : []}
        onSubmitAttempt={() => setReleaseTouched(true)}
        submitLabel="Release Trip to Pool"
        confirmSubmitTitle="Confirm Trip Release"
        confirmSubmitDescription="Return this funded job cleanly to the open Pick N Drop pool?"
        confirmSubmitVariant="warning"
        isSubmitting={releaseBusy}
        maxWidthClassName="max-w-md"
        onSubmit={handleConfirmReleaseTrip}
        onClose={() => {
          setReleaseOrder(null);
          setReleaseReason('');
          setReleaseTouched(false);
        }}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="driver-release-reason"
            className="block text-xs font-bold text-[var(--ps-text)]"
          >
            Reason for Releasing Assignment *
          </label>
          <textarea
            id="driver-release-reason"
            rows={3}
            value={releaseReason}
            onChange={(e) => setReleaseReason(e.target.value)}
            onBlur={() => setReleaseTouched(true)}
            placeholder="e.g., Flat tyre near Tuibong Bazaar, unable to reach pickup within 10 mins"
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
          />
          {releaseTouched && releaseReasonError && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {releaseReasonError}
            </p>
          )}
        </div>
      </FormModal>
    </div>
  );
}

export interface DriverAvailableJobBoardProps {
  driver: DriverProfileRow | null;
  isKycReady: boolean;
  jobs: DriverAvailableJobRow[];
  loading: boolean;
  onRefresh: () => void;
  onAcceptJob: (job: DriverAvailableJobRow) => Promise<void>;
}

export function DriverAvailableJobBoard({
  driver,
  isKycReady,
  jobs,
  loading,
  onRefresh,
  onAcceptJob,
}: DriverAvailableJobBoardProps) {
  const [selectedJob, setSelectedJob] = useState<DriverAvailableJobRow | null>(
    null
  );
  const [acceptBusy, setAcceptBusy] = useState(false);

  const handleConfirmAccept = async () => {
    if (!selectedJob) return;
    setAcceptBusy(true);
    try {
      await onAcceptJob(selectedJob);
      setSelectedJob(null);
    } finally {
      setAcceptBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="h-32 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Available Pick N Drop Pool
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Filtered to funded, unassigned jobs matching{' '}
            <span className="font-semibold text-[var(--ps-text)]">
              {driver ? formatDriverFleetLabel(driver.vehicle_type) : 'your fleet class'}
            </span>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Pool
        </button>
      </div>

      {!isKycReady && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Job Acceptance Paused Until KYC Approval</p>
            <p className="mt-0.5 opacity-90">
              You can preview available trips now, and accepting jobs will unlock automatically once your driver profile is verified and active.
            </p>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
          <Package className="mx-auto h-9 w-9 text-[var(--ps-text-muted)] opacity-60" />
          <p className="text-sm font-bold text-[var(--ps-text)]">
            No unassigned funded jobs right now
          </p>
          <p className="text-xs text-[var(--ps-text-muted)]">
            New Pick N Drop orders verified by Dispatch Mediators appear here automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Stacked Cards (< lg) */}
          <div className="space-y-3 lg:hidden">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderServiceIcon(job.service_mode)}
                    <div>
                      <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                        {job.order_code}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                          {formatServiceModeLabel(job.service_mode)}
                        </span>
                        {job.escrow_funded && (
                          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            Escrow Funded
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                      {formatInr(job.estimated_driver_payout_inr)}
                    </p>
                    <p className="text-[10px] text-[var(--ps-text-muted)]">
                      {job.distance_km} km est.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs">
                  <p className="text-[var(--ps-text)]">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      Pickup:{' '}
                    </span>
                    {job.pickup_address}
                  </p>
                  <p className="text-[var(--ps-text)]">
                    <span className="font-bold text-rose-600 dark:text-rose-400">
                      Dropoff:{' '}
                    </span>
                    {job.dropoff_address}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!isKycReady}
                  onClick={() => setSelectedJob(job)}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Accept Funded Job</span>
                </button>
              </div>
            ))}
          </div>

          {/* Desktop Compact Table (lg+) */}
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Order / Type</th>
                    <th className="px-4 py-3">Pickup → Dropoff</th>
                    <th className="px-4 py-3">Distance</th>
                    <th className="px-4 py-3">Est. Payout</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ps-border)]">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="hover:bg-[var(--ps-bg)]/60 transition-colors"
                    >
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center gap-2">
                          {renderServiceIcon(job.service_mode)}
                          <div>
                            <div className="font-mono font-bold text-[var(--ps-text)]">
                              {job.order_code}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-[11px] text-[var(--ps-text-muted)]">
                                {formatServiceModeLabel(job.service_mode)}
                              </span>
                              {job.escrow_funded && (
                                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                  Escrow Funded
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top max-w-md">
                        <p className="font-medium text-[var(--ps-text)] truncate">
                          A: {job.pickup_address}
                        </p>
                        <p className="mt-0.5 text-[var(--ps-text-muted)] truncate">
                          B: {job.dropoff_address}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono font-semibold text-[var(--ps-text)] whitespace-nowrap">
                        {job.distance_km} km
                      </td>
                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        <div className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                          {formatInr(job.estimated_driver_payout_inr)}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          Fare {formatInr(job.quoted_fare_inr)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top text-right">
                        <button
                          type="button"
                          disabled={!isKycReady}
                          onClick={() => setSelectedJob(job)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Accept Job</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Race-Safe Job Acceptance ConfirmDialog */}
      <ConfirmDialog
        isOpen={Boolean(selectedJob)}
        title={
          selectedJob
            ? `Accept Job ${selectedJob.order_code}?`
            : 'Accept Pick N Drop Job'
        }
        description="This job is atomically locked to your driver account upon confirmation."
        caution="Only accept if you can head to the pickup location immediately. Pickup & Dropoff OTP verification is required to release escrow payout."
        impactSummary={
          selectedJob
            ? [
                `Route: ${selectedJob.pickup_address} → ${selectedJob.dropoff_address}`,
                `Type: ${formatServiceModeLabel(selectedJob.service_mode)} (${selectedJob.distance_km} km)`,
                `Estimated Driver Payout: ${formatInr(selectedJob.estimated_driver_payout_inr)}`,
              ]
            : undefined
        }
        confirmLabel="Confirm & Accept Job"
        loading={acceptBusy}
        onConfirm={handleConfirmAccept}
        onCancel={() => {
          if (!acceptBusy) setSelectedJob(null);
        }}
      />
    </div>
  );
}
