/**
 * Sprint v19a: Dispatch Mediator / UPI Escrow Workspace Types & Helpers
 * Strictly typed against canonical Pick N Drop (`delivery_orders`, `delivery_transactions`),
 * Scheduled Vehicles (`vehicle_bookings`), `payment_intents`, `drivers`, and `audit_logs`.
 */

export const DUPLICATE_UTR_FRIENDLY_MESSAGE =
  'This UPI UTR reference has already been submitted. Please check your transaction ID or contact support.';

export const POD_PURGED_POLICY_MESSAGE =
  'Purged automatically after 48 hours per privacy policy';

export type MediatorSectionId =
  | 'overview'
  | 'upi_queue'
  | 'live_dispatch'
  | 'escrow_payouts'
  | 'audit_history';

export type MediatorDomainFilter = 'all' | 'pick_n_drop' | 'vehicle_booking';

export type FleetClassSlug =
  | 'cycle_rickshaw'
  | 'two_wheeler'
  | 'e_rickshaw'
  | 'mini_van'
  | 'pickup_truck';

export const FLEET_CLASS_LABELS: Record<FleetClassSlug, string> = {
  cycle_rickshaw: 'Cycle Rickshaw',
  two_wheeler: 'Scooty / Two-Wheeler',
  e_rickshaw: 'E-Rickshaw / Auto',
  mini_van: 'Mini Van / Alto',
  pickup_truck: 'Pickup Truck / Bolero',
};

export function normalizeFleetClassSlug(
  raw: string | null | undefined
): FleetClassSlug | string {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (clean === 'auto') return 'e_rickshaw';
  if (clean === 'car') return 'mini_van';
  return clean || 'two_wheeler';
}

export function formatFleetClassLabel(raw: string | null | undefined): string {
  const normalized = normalizeFleetClassSlug(raw) as FleetClassSlug;
  return FLEET_CLASS_LABELS[normalized] || normalized.replace(/_/g, ' ');
}

/**
 * Maps PostgreSQL 23505 unique-constraint errors or duplicate-UTR messages
 * into our clean customer-facing message with zero raw Postgres details.
 */
export function mapDuplicateUtrError(
  error:
    | { code?: string | null; message?: string | null; details?: string | null }
    | string
    | null
    | undefined
): string {
  if (!error) {
    return 'Unable to submit UPI reference. Please verify and try again.';
  }

  const code = typeof error === 'string' ? '' : String(error.code || '');
  const rawMessage =
    typeof error === 'string'
      ? error
      : `${error.message || ''} ${error.details || ''}`.trim();
  const lower = rawMessage.toLowerCase();

  if (
    code === '23505' ||
    lower.includes('23505') ||
    lower.includes('idx_payment_intents_unique_active_utr') ||
    lower.includes('idx_delivery_transactions_unique_active_utr') ||
    lower.includes('idx_unique_succeeded_utr') ||
    (lower.includes('duplicate key') && lower.includes('utr')) ||
    (lower.includes('already') && lower.includes('utr'))
  ) {
    return DUPLICATE_UTR_FRIENDLY_MESSAGE;
  }

  return rawMessage || 'Unable to submit UPI reference. Please try again.';
}

export type SlaSeverity = 'normal' | 'warning' | 'urgent';

export interface SlaStatusMeta {
  elapsedMinutes: number;
  elapsedSeconds: number;
  severity: SlaSeverity;
  label: string;
  isOverdue: boolean;
}

/**
 * Computes the live 10-minute Mediator UPI Verification SLA status:
 * - < 5m: normal
 * - 5–10m: warning (amber)
 * - > 10m: urgent (red overdue)
 */
export function computeUpiSlaStatus(
  submittedAtIso: string | null | undefined,
  nowMs: number
): SlaStatusMeta {
  const submittedMs = submittedAtIso ? Date.parse(submittedAtIso) : NaN;
  if (!Number.isFinite(submittedMs)) {
    return {
      elapsedMinutes: 0,
      elapsedSeconds: 0,
      severity: 'normal',
      label: 'Just submitted',
      isOverdue: false,
    };
  }

  const diffSeconds = Math.max(0, Math.floor((nowMs - submittedMs) / 1000));
  const elapsedMinutes = Math.floor(diffSeconds / 60);
  const remSeconds = diffSeconds % 60;

  let severity: SlaSeverity = 'normal';
  if (diffSeconds > 600) {
    severity = 'urgent';
  } else if (diffSeconds >= 300) {
    severity = 'warning';
  }

  let label: string;
  if (elapsedMinutes >= 60) {
    const hrs = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    label = `${hrs}h ${mins}m elapsed`;
  } else {
    label = `${elapsedMinutes}m ${String(remSeconds).padStart(2, '0')}s`;
  }

  return {
    elapsedMinutes,
    elapsedSeconds: diffSeconds,
    severity,
    label,
    isOverdue: diffSeconds > 600,
  };
}

export interface MediatorOtpMilestone {
  pickup_verified: boolean;
  pickup_verified_at: string | null;
  dropoff_verified: boolean;
  dropoff_verified_at: string | null;
  return_required: boolean;
  return_verified: boolean;
  return_verified_at: string | null;
  failed_attempts: number;
  is_locked: boolean;
}

export interface MediatorDriverOption {
  id: string;
  profile_id: string | null;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_reg_no: string | null;
  kyc_verified: boolean;
  kyc_status: string;
  is_online: boolean;
  is_active: boolean;
  hub_id: string | null;
}

export interface MediatorVehicleType {
  id: string;
  slug: string;
  name: string;
}

export interface MediatorPaymentQueueItem {
  id: string; // canonical booking_id (delivery_orders.id or vehicle_bookings.id)
  domain: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  status: string;
  paymentIntentId: string | null;
  utrRef: string | null;
  proofPath: string | null;
  expectedAmountInr: number;
  submittedAmountInr: number;
  customerName: string;
  customerPhone: string;
  routeSummary: string;
  vehicleClassSlug: string;
  vehicleClassName: string;
  submittedAt: string;
  createdAt: string;
}

export interface MediatorDispatchItem {
  id: string;
  domain: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  status: string;
  serviceLabel: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareInr: number;
  vehicleTypeId: string | null;
  vehicleClassSlug: string;
  vehicleClassName: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  createdAt: string;
  paymentVerifiedAt: string | null;
}

export interface MediatorEscrowItem {
  id: string;
  domain: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  status: string;
  escrowStateLabel: string;
  tripType: 'one_way' | 'two_way' | 'scheduled';
  fareInr: number;
  payoutAmountInr: number;
  customerName: string;
  customerPhone: string;
  driverName: string | null;
  driverPhone: string | null;
  routeSummary: string;
  disputeReason: string | null;
  podStoragePath: string | null;
  podUploadedAt: string | null;
  podPurgeAt: string | null;
  payoutReleasedAt: string | null;
  updatedAt: string;
  otpMilestones: MediatorOtpMilestone;
}

export interface MediatorAuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  workspace: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  target_name: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface MediatorKpiMetrics {
  pendingUpiCount: number;
  overdueSlaCount: number;
  activeFundedEscrowsCount: number;
  activeFundedEscrowsValueInr: number;
  openDisputesCount: number;
  releasedTodayInr: number;
  releasedTodayCount: number;
}
