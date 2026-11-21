// =============================================================================
// Phase 72-A: Polymorphic Listing Verticals & Public/Government Civic Types
// =============================================================================

export const LISTING_VERTICALS = [
  'general',
  'print_digital',
  'booking_venue',
  'shop_catalogue',
  'real_estate',
  'restaurant_food',
  'hotel_stay',
  'public_civic',
] as const;

export type ListingVertical = (typeof LISTING_VERTICALS)[number];

export const CIVIC_DEPARTMENT_TYPES = [
  'emergency_medical',
  'police_fire',
  'government_office',
  'utility_power_water',
  'public_transport_hub',
  'community_religious',
  'education_public',
] as const;

export type CivicDepartmentType = (typeof CIVIC_DEPARTMENT_TYPES)[number];

export const CIVIC_CORRECTION_ISSUE_TYPES = [
  'wrong_phone',
  'wrong_hours',
  'wrong_location',
  'outdated_checklist',
  'closed_relocated',
  'other',
] as const;

export type CivicCorrectionIssueType =
  (typeof CIVIC_CORRECTION_ISSUE_TYPES)[number];

export type CivicCorrectionStatus = 'pending' | 'approved' | 'rejected';

export interface PrintVerticalSummary {
  is_first_party_printswift?: boolean;
  is_accepting_orders?: boolean;
  turnaround_badge?: 'express_30m' | 'same_day' | 'next_day' | string;
  verified_capabilities?: Record<string, boolean>;
}

export interface CivicVerticalSummary {
  department_type?: CivicDepartmentType;
  is_24x7?: boolean;
  primary_phone?: string | null;
  helpline_count?: number;
  checklist_count?: number;
  has_active_alert?: boolean;
}

export type VerticalSummary = PrintVerticalSummary &
  CivicVerticalSummary &
  Record<string, unknown>;

export interface CivicHelpline {
  label: string;
  phone: string;
  is_emergency?: boolean;
  whatsapp?: boolean;
}

export interface CivicDocumentChecklist {
  service_title: string;
  required_docs: string[];
  fee_note?: string | null;
  processing_time?: string | null;
}

export interface ListingCivicProfile {
  listing_id: string;
  hub_id: string;
  department_type: CivicDepartmentType;
  is_24x7: boolean;
  office_hours_text: string | null;
  helplines: CivicHelpline[];
  document_checklists: CivicDocumentChecklist[];
  important_notes: string | null;
  live_civic_alert: string | null;
  live_civic_alert_expires_at: string | null;
  official_website: string | null;
  show_nearby_print_helper: boolean;
  last_verified_at: string | null;
  last_verified_by: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CivicCorrectionReport {
  id: string;
  hub_id: string;
  listing_id: string;
  reporter_id: string | null;
  reporter_contact: string | null;
  issue_type: CivicCorrectionIssueType;
  suggested_correction: string;
  status: CivicCorrectionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  created_at: string;
  listing_title?: string | null;
}

/**
 * Determines whether a listing vertical opens a dedicated `/listing/[id]` detail page.
 * Public & Government (`public_civic`) records terminate cleanly at the Map Summary Modal.
 */
export function hasDedicatedDetailRoute(vertical: ListingVertical): boolean {
  return vertical !== 'public_civic';
}

export function isValidListingVertical(val: unknown): val is ListingVertical {
  return (
    typeof val === 'string' &&
    (LISTING_VERTICALS as readonly string[]).includes(val)
  );
}

export function isValidCivicDepartmentType(
  val: unknown
): val is CivicDepartmentType {
  return (
    typeof val === 'string' &&
    (CIVIC_DEPARTMENT_TYPES as readonly string[]).includes(val)
  );
}

export function isValidCivicIssueType(
  val: unknown
): val is CivicCorrectionIssueType {
  return (
    typeof val === 'string' &&
    (CIVIC_CORRECTION_ISSUE_TYPES as readonly string[]).includes(val)
  );
}
