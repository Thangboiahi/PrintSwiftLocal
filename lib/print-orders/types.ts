export const PRINT_DOCUMENTS_BUCKET = 'print-documents';
export const MAX_PRINT_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PRINT_PDF_PAGES = 2000;

export const ALLOWED_PRINT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPrintMimeType = (typeof ALLOWED_PRINT_MIME_TYPES)[number];

// -----------------------------------------------------------------------------
// Five Separate Independent Lifecycles (Phase 71-A Schema)
// -----------------------------------------------------------------------------

export type PrintQuoteStatus =
  | 'unquoted'
  | 'awaiting_shop_quote'
  | 'quoted'
  | 'accepted'
  | 'expired';

export type PrintPaymentStatus =
  | 'not_required_yet'
  | 'unpaid'
  | 'pending_manual_review'
  | 'escrow_held'
  | 'paid_direct_confirmed'
  | 'refunded';

export type PrintFulfillmentStatus =
  | 'draft'
  | 'confirmed'
  | 'printing'
  | 'ready_for_pickup'
  | 'handed_to_rider'
  | 'collected'
  | 'cancelled';

export type PrintSettlementStatus =
  | 'not_applicable'
  | 'locked'
  | 'eligible'
  | 'settled'
  | 'reversed';

export type PrintPurgeStatus = 'active' | 'scheduled' | 'purged';
export type PrintFilePurgeStatus = 'active' | 'purged';

// -----------------------------------------------------------------------------
// Domain Mode & Configuration Unions
// -----------------------------------------------------------------------------

export type PrintJobMode = 'instant_print' | 'custom_digital';

export type PrintPaymentRail =
  | 'direct_counter'
  | 'direct_shop_upi'
  | 'platform_escrow';

export type PrintHandoverMode = 'walk_in_pickup' | 'pick_n_drop';

export type PrintTurnaroundBadge = 'express_30m' | 'same_day' | 'next_day';

export type PrintColorMode = 'bw' | 'color';
export type PrintPaperSize = 'A4' | 'A3';
export type PagesPerSheetOption = 1 | 2 | 4;

// -----------------------------------------------------------------------------
// Shop Print Profile, Capabilities, Rate Card & Payment Policy
// -----------------------------------------------------------------------------

export interface PrintCapabilities {
  bw_a4: boolean;
  color_a4: boolean;
  duplex: boolean;
  a3_large: boolean;
  spiral_binding: boolean;
  lamination: boolean;
  custom_digital_jobs: boolean;
  sealed_envelope: boolean;
}

export type PrintVerifiedCapabilities = Partial<
  Record<keyof PrintCapabilities, boolean>
>;

export interface PrintBulkDiscountTier {
  min_pages: number;
  discount_percent: number;
}

export interface PrintRateCard {
  bw_a4_single_inr?: number;
  bw_a4_duplex_inr?: number;
  color_a4_single_inr?: number;
  color_a4_duplex_inr?: number;
  a3_bw_inr?: number;
  a3_bw_duplex_inr?: number;
  a3_color_inr?: number;
  a3_color_duplex_inr?: number;
  legal_bw_single_inr?: number;
  legal_bw_duplex_inr?: number;
  legal_color_single_inr?: number;
  legal_color_duplex_inr?: number;
  spiral_binding_inr?: number;
  hard_binding_inr?: number;
  lamination_per_sheet_inr?: number;
  staple_inr?: number;
  sealed_envelope_inr?: number;
  min_order_inr?: number;
  urgent_express_surcharge_type?: 'flat' | 'percent';
  urgent_express_surcharge_value?: number;
  platform_fee_inr?: number;
  bulk_discounts?: PrintBulkDiscountTier[];
}

export interface PrintPaymentPolicy {
  allow_direct_pay: boolean;
  direct_pay_max_inr: number;
  allow_escrow: boolean;
  shop_upi_id: string | null;
  shop_upi_name: string | null;
  shop_upi_verified: boolean;
}

export interface ListingPrintProfile {
  listing_id: string;
  hub_id: string;
  is_official_printswift?: boolean;
  is_first_party_printswift: boolean;
  is_accepting_orders: boolean;
  express_eta_mins?: number;
  supports_pick_n_drop?: boolean;
  busy_until: string | null;
  pricing_version: number;
  capabilities: PrintCapabilities;
  verified_capabilities: PrintVerifiedCapabilities;
  rate_card: PrintRateCard;
  pricing_matrix?: PrintRateCard;
  payment_policy: PrintPaymentPolicy;
  turnaround_badge: PrintTurnaroundBadge;
  pickup_instructions: string | null;
  max_file_size_mb: number;
  created_at?: string;
  updated_at?: string;
}

// -----------------------------------------------------------------------------
// Print File Options, Order Files & Quote Snapshot
// -----------------------------------------------------------------------------

export interface PrintFileOptions {
  color_mode?: PrintColorMode;
  color?: boolean;
  duplex?: boolean;
  paper_size?: PrintPaperSize;
  a3?: boolean;
  page_range?: string | null;
  pages_per_sheet?: PagesPerSheetOption;
  copies?: number;
  binding?: boolean;
  lamination?: boolean;
  staple?: boolean;
}

export interface NormalizedPrintFileOptions {
  color_mode: PrintColorMode;
  duplex: boolean;
  paper_size: PrintPaperSize;
  page_range: string;
  pages_per_sheet: PagesPerSheetOption;
  copies: number;
  binding: boolean;
  lamination: boolean;
  staple: boolean;
}

export interface PrintOrderFile {
  id: string;
  print_order_id: string;
  storage_object_key: string;
  display_label_masked: string;
  mime_type: string;
  file_size_bytes: number;
  server_verified_pages: number;
  print_options: PrintFileOptions;
  purge_status: PrintFilePurgeStatus;
  purged_at: string | null;
  created_at: string;
}

export interface PrintQuoteFileBreakdown {
  file_id: string;
  display_label_masked: string;
  source_pages: number;
  selected_pages: number;
  pages_per_sheet: PagesPerSheetOption;
  copies: number;
  logical_sides: number;
  physical_sheets: number;
  options: NormalizedPrintFileOptions;
  unit_rate_inr: number;
  print_subtotal_inr: number;
  binding_fee_inr: number;
  lamination_fee_inr: number;
  staple_fee_inr: number;
  finishing_total_inr: number;
  line_total_inr: number;
}

export interface PrintQuoteSnapshot {
  pricing_version: number;
  calculated_at: string;
  currency: 'INR';
  job_mode: PrintJobMode;
  handover_mode: PrintHandoverMode;
  sealed_envelope_requested: boolean;
  files: PrintQuoteFileBreakdown[];
  total_selected_pages: number;
  total_logical_sides: number;
  total_physical_sheets: number;
  print_subtotal_inr: number;
  bulk_discount_percent: number;
  bulk_discount_inr: number;
  finishing_total_inr: number;
  sealed_envelope_fee_inr: number;
  min_order_adjustment_inr: number;
  platform_fee_inr: number;
  total_amount_inr: number;
  allowed_payment_rails: PrintPaymentRail[];
  forced_escrow: boolean;
  forced_escrow_reason: string | null;
  custom_quote_note?: string | null;
  custom_turnaround_note?: string | null;
}

// -----------------------------------------------------------------------------
// Print Orders, Events & Merchant Settlements
// -----------------------------------------------------------------------------

export interface PrintOrder {
  id: string;
  order_code: string;
  hub_id: string;
  listing_id: string;
  customer_id: string;
  is_first_party_order: boolean;
  job_mode: PrintJobMode;
  service_category_slug: string | null;
  customer_instructions: string | null;
  quote_snapshot: PrintQuoteSnapshot | Record<string, unknown>;
  quoted_amount_inr: number | null;
  platform_fee_inr: number;
  payment_rail: PrintPaymentRail;
  payment_intent_id: string | null;
  handover_mode: PrintHandoverMode;
  linked_delivery_order_id: string | null;
  sealed_envelope_requested: boolean;
  phone_otp_verified_at: string | null;
  collection_otp_hash: string | null;
  collection_otp_display_for_customer: string | null;
  quote_status: PrintQuoteStatus;
  payment_status: PrintPaymentStatus;
  fulfillment_status: PrintFulfillmentStatus;
  settlement_status: PrintSettlementStatus;
  purge_status: PrintPurgeStatus;
  collected_at: string | null;
  purge_scheduled_at: string | null;
  files_purged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrintOrderEvent {
  id: string;
  print_order_id: string;
  actor_id: string | null;
  actor_role: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MerchantSettlement {
  id: string;
  hub_id: string;
  listing_id: string;
  owner_id: string;
  print_order_id: string;
  gross_amount_inr: number;
  platform_fee_inr: number;
  net_payable_inr: number;
  status: Exclude<PrintSettlementStatus, 'not_applicable'>;
  payout_reference: string | null;
  settled_by: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PrintFileValidationResult =
  | {
      valid: true;
      pageCount: number;
      mimeType: AllowedPrintMimeType;
      extension: 'pdf' | 'jpg' | 'png' | 'webp';
      byteSize: number;
    }
  | {
      valid: false;
      error: string;
      code:
        | 'EMPTY_FILE'
        | 'FILE_TOO_LARGE'
        | 'UNSUPPORTED_MIME_TYPE'
        | 'INVALID_MAGIC_BYTES'
        | 'PDF_ENCRYPTED'
        | 'PDF_MALFORMED'
        | 'PDF_PAGE_LIMIT_EXCEEDED';
    };
