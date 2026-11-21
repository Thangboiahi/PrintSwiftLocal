import type {
  ListingPrintProfile,
  NormalizedPrintFileOptions,
  PagesPerSheetOption,
  PrintCapabilities,
  PrintColorMode,
  PrintFileOptions,
  PrintHandoverMode,
  PrintJobMode,
  PrintOrderFile,
  PrintPaperSize,
  PrintPaymentRail,
  PrintQuoteFileBreakdown,
  PrintQuoteSnapshot,
} from '@/lib/print-orders/types';

export class PrintQuoteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code = 'INVALID_QUOTE_REQUEST', statusCode = 400) {
    super(message);
    this.name = 'PrintQuoteError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface QuoteFileInput {
  id: string;
  display_label_masked: string;
  server_verified_pages: number;
  print_options?: PrintFileOptions | null;
}

export interface RequestedQuoteOptionsInput extends PrintFileOptions {
  custom_digital_jobs?: boolean;
}

export interface CalculatePrintQuoteParams {
  profile: ListingPrintProfile;
  files: Array<Pick<PrintOrderFile, 'id' | 'display_label_masked' | 'server_verified_pages'> & { print_options?: PrintFileOptions | null }>;
  requestedOptions?:
    | RequestedQuoteOptionsInput
    | Array<{ fileId?: string; file_id?: string; options?: PrintFileOptions } & PrintFileOptions>;
  handoverMode: PrintHandoverMode;
  sealedEnvelopeRequested?: boolean;
  customerNoShowCount?: number;
  jobMode?: PrintJobMode;
}

export interface CalculatePrintQuoteResult {
  quoteSnapshot: PrintQuoteSnapshot;
  allowedPaymentRails: PrintPaymentRail[];
  forcedEscrow: boolean;
  forcedEscrowReason: string | null;
  railReason: string | null;
}

function roundInr(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function readPositiveNumber(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isCapabilitySupported(
  profile: ListingPrintProfile,
  key: keyof PrintCapabilities,
  requireVerifiedIfPresent = false
): boolean {
  const selfDeclared = Boolean(profile.capabilities?.[key]);
  if (!selfDeclared) return false;

  const verifiedMap = profile.verified_capabilities || {};
  if (verifiedMap[key] === false) {
    return false;
  }
  if (
    requireVerifiedIfPresent &&
    Object.keys(verifiedMap).length > 0 &&
    verifiedMap[key] !== undefined &&
    verifiedMap[key] !== true
  ) {
    return false;
  }
  return true;
}

/**
 * Parses a human-friendly page range string (e.g. "all", "1-5", "1-3, 7, 10-12")
 * and returns the unique count of selected pages within 1..totalPages.
 */
export function parsePageRangeCount(
  pageRangeRaw: string | null | undefined,
  totalPages: number
): { normalizedRange: string; selectedPages: number } {
  const safeTotal = Math.max(1, Math.floor(totalPages));
  const raw = String(pageRangeRaw ?? '').trim();

  if (!raw || raw.toLowerCase() === 'all') {
    return {
      normalizedRange: 'all',
      selectedPages: safeTotal,
    };
  }

  const pageSet = new Set<number>();
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      normalizedRange: 'all',
      selectedPages: safeTotal,
    };
  }

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const pageNum = Number.parseInt(token, 10);
      if (pageNum < 1 || pageNum > safeTotal) {
        throw new PrintQuoteError(
          `Page ${pageNum} in range "${raw}" is outside document page bounds (1-${safeTotal}).`,
          'INVALID_PAGE_RANGE'
        );
      }
      pageSet.add(pageNum);
      continue;
    }

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      throw new PrintQuoteError(
        `Invalid page range syntax "${token}". Use formats like "all", "1-5", or "1-3, 7".`,
        'INVALID_PAGE_RANGE'
      );
    }

    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (start < 1 || end < start || end > safeTotal) {
      throw new PrintQuoteError(
        `Page range "${start}-${end}" is invalid for a ${safeTotal}-page document.`,
        'INVALID_PAGE_RANGE'
      );
    }

    for (let p = start; p <= end; p += 1) {
      pageSet.add(p);
    }
  }

  if (pageSet.size === 0) {
    throw new PrintQuoteError(
      'Page range must select at least 1 page.',
      'INVALID_PAGE_RANGE'
    );
  }

  return {
    normalizedRange: tokens.join(', '),
    selectedPages: pageSet.size,
  };
}

function normalizeFileOptions(
  base: PrintFileOptions | null | undefined,
  override: PrintFileOptions | null | undefined
): NormalizedPrintFileOptions {
  const merged: PrintFileOptions = {
    ...(base || {}),
    ...(override || {}),
  };

  const colorMode: PrintColorMode =
    merged.color_mode === 'color' || merged.color === true ? 'color' : 'bw';

  const paperSize: PrintPaperSize =
    merged.paper_size === 'A3' || merged.a3 === true ? 'A3' : 'A4';

  const rawNup = Number(merged.pages_per_sheet ?? 1);
  if (![1, 2, 4].includes(rawNup)) {
    throw new PrintQuoteError(
      'pages_per_sheet must be 1, 2, or 4.',
      'INVALID_PAGES_PER_SHEET'
    );
  }
  const pagesPerSheet = rawNup as PagesPerSheetOption;

  const rawCopies = Number(merged.copies ?? 1);
  if (!Number.isFinite(rawCopies) || rawCopies < 1 || rawCopies > 500) {
    throw new PrintQuoteError(
      'copies must be an integer between 1 and 500.',
      'INVALID_COPIES'
    );
  }
  const copies = Math.floor(rawCopies);

  return {
    color_mode: colorMode,
    duplex: Boolean(merged.duplex),
    paper_size: paperSize,
    page_range: String(merged.page_range ?? 'all').trim() || 'all',
    pages_per_sheet: pagesPerSheet,
    copies,
    binding: Boolean(merged.binding),
    lamination: Boolean(merged.lamination),
    staple: Boolean(merged.staple),
  };
}

function resolveRequestedOptionsForFile(
  fileId: string,
  index: number,
  requestedOptions: CalculatePrintQuoteParams['requestedOptions']
): PrintFileOptions | undefined {
  if (!requestedOptions) return undefined;
  if (Array.isArray(requestedOptions)) {
    const matched =
      requestedOptions.find(
        (item) => item.fileId === fileId || item.file_id === fileId
      ) || requestedOptions[index];
    if (!matched) return undefined;
    return matched.options ? { ...matched, ...matched.options } : matched;
  }
  return requestedOptions;
}

function resolveUnitPrintRateInr(
  profile: ListingPrintProfile,
  options: NormalizedPrintFileOptions
): number {
  const rc = profile.rate_card || {};
  const bwSingle = readPositiveNumber(rc.bw_a4_single_inr, 2);
  const bwDuplex = readPositiveNumber(rc.bw_a4_duplex_inr, roundInr(bwSingle * 0.85));
  const colorSingle = readPositiveNumber(rc.color_a4_single_inr, 10);
  const colorDuplex = readPositiveNumber(
    rc.color_a4_duplex_inr,
    roundInr(colorSingle * 0.9)
  );
  const a3Bw = readPositiveNumber(rc.a3_bw_inr, 15);
  const a3Color = readPositiveNumber(rc.a3_color_inr, 40);

  if (options.paper_size === 'A3') {
    return options.color_mode === 'color' ? a3Color : a3Bw;
  }

  if (options.color_mode === 'color') {
    return options.duplex ? colorDuplex : colorSingle;
  }

  return options.duplex ? bwDuplex : bwSingle;
}

function resolveBulkDiscountPercent(
  profile: ListingPrintProfile,
  totalLogicalSides: number
): number {
  const tiers = Array.isArray(profile.rate_card?.bulk_discounts)
    ? profile.rate_card.bulk_discounts
    : [];

  let bestDiscount = 0;
  for (const tier of tiers) {
    const minPages = Number(tier?.min_pages ?? 0);
    const pct = Number(tier?.discount_percent ?? 0);
    if (
      Number.isFinite(minPages) &&
      minPages > 0 &&
      Number.isFinite(pct) &&
      pct > 0 &&
      pct <= 70 &&
      totalLogicalSides >= minPages &&
      pct > bestDiscount
    ) {
      bestDiscount = pct;
    }
  }
  return bestDiscount;
}

/**
 * Resolves DD oodle Dual-Rail Payment Rules deterministically.
 */
export function resolveDualRailPaymentPolicy(params: {
  profile: ListingPrintProfile;
  handoverMode: PrintHandoverMode;
  totalAmountInr: number;
  customerNoShowCount?: number;
}): {
  allowedPaymentRails: PrintPaymentRail[];
  forcedEscrow: boolean;
  forcedEscrowReason: string | null;
  railReason: string | null;
} {
  const { profile, handoverMode, totalAmountInr } = params;
  const noShowCount = Math.max(0, Math.floor(Number(params.customerNoShowCount ?? 0)));
  const policy = profile.payment_policy || {
    allow_direct_pay: true,
    direct_pay_max_inr: 300,
    allow_escrow: true,
    shop_upi_id: null,
    shop_upi_name: null,
    shop_upi_verified: false,
  };
  const directPayMaxInr = readPositiveNumber(policy.direct_pay_max_inr, 300);

  const forcedReasons: string[] = [];

  if (profile.is_first_party_printswift === true) {
    forcedReasons.push(
      'Official PrintSwift orders require secure Platform Escrow payment.'
    );
  }
  if (handoverMode === 'pick_n_drop') {
    forcedReasons.push(
      'Pick N Drop delivery orders require Platform Escrow payment.'
    );
  }
  if (totalAmountInr > directPayMaxInr) {
    forcedReasons.push(
      `Orders above ₹${directPayMaxInr} require Platform Escrow payment.`
    );
  }
  if (policy.allow_direct_pay === false) {
    forcedReasons.push(
      'This shop requires Platform Escrow payment for online print orders.'
    );
  }
  if (noShowCount >= 2) {
    forcedReasons.push(
      'Platform Escrow is required on this account due to prior uncollected orders.'
    );
  }

  if (forcedReasons.length > 0) {
    return {
      allowedPaymentRails: ['platform_escrow'],
      forcedEscrow: true,
      forcedEscrowReason: forcedReasons[0],
      railReason: forcedReasons.join(' '),
    };
  }

  const allowedRails: PrintPaymentRail[] = ['direct_counter'];
  if (typeof policy.shop_upi_id === 'string' && policy.shop_upi_id.trim().length > 0) {
    allowedRails.push('direct_shop_upi');
  }
  if (policy.allow_escrow !== false) {
    allowedRails.push('platform_escrow');
  }

  return {
    allowedPaymentRails: allowedRails,
    forcedEscrow: false,
    forcedEscrowReason: null,
    railReason: null,
  };
}

/**
 * Calculates a deterministic, capability-checked Print & Digital quote snapshot
 * stamped with the shop's current `pricing_version` and Dual-Rail payment eligibility.
 */
export function calculatePrintQuote(
  params: CalculatePrintQuoteParams
): CalculatePrintQuoteResult {
  const {
    profile,
    files,
    requestedOptions,
    handoverMode,
    sealedEnvelopeRequested = false,
    customerNoShowCount = 0,
    jobMode = 'instant_print',
  } = params;

  // Validate custom_digital_jobs capability when requested
  const wantsCustomDigital =
    jobMode === 'custom_digital' ||
    (!Array.isArray(requestedOptions) &&
      requestedOptions?.custom_digital_jobs === true);

  if (wantsCustomDigital && !isCapabilitySupported(profile, 'custom_digital_jobs', true)) {
    throw new PrintQuoteError(
      'This shop does not currently accept Custom Digital & Design jobs online.',
      'CAPABILITY_UNSUPPORTED'
    );
  }

  if (
    sealedEnvelopeRequested &&
    !isCapabilitySupported(profile, 'sealed_envelope')
  ) {
    throw new PrintQuoteError(
      'This shop does not support sealed envelope packaging.',
      'CAPABILITY_UNSUPPORTED'
    );
  }

  if (jobMode === 'instant_print' && (!Array.isArray(files) || files.length === 0)) {
    throw new PrintQuoteError(
      'At least one validated print file is required to calculate an instant print quote.',
      'NO_FILES_ATTACHED'
    );
  }

  const rc = profile.rate_card || {};
  const spiralBindingRate = readPositiveNumber(rc.spiral_binding_inr, 35);
  const laminationPerSheetRate = readPositiveNumber(
    rc.lamination_per_sheet_inr,
    20
  );
  const stapleRate = readPositiveNumber(rc.staple_inr, 5);
  const sealedEnvelopeRate = readPositiveNumber(rc.sealed_envelope_inr, 10);
  const minOrderInr = readPositiveNumber(rc.min_order_inr, 0);
  const platformFeeInr = readPositiveNumber(rc.platform_fee_inr, 0);

  const fileBreakdowns: PrintQuoteFileBreakdown[] = [];
  let totalSelectedPages = 0;
  let totalLogicalSides = 0;
  let totalPhysicalSheets = 0;
  let printSubtotal = 0;
  let finishingTotal = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const overrideOpts = resolveRequestedOptionsForFile(
      file.id,
      i,
      requestedOptions
    );
    const normalizedOpts = normalizeFileOptions(file.print_options, overrideOpts);

    // Strictly verify every requested hardware/service capability against profile
    if (
      normalizedOpts.color_mode === 'bw' &&
      normalizedOpts.paper_size === 'A4' &&
      !isCapabilitySupported(profile, 'bw_a4')
    ) {
      throw new PrintQuoteError(
        'This shop does not currently offer A4 B&W printing.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    if (
      normalizedOpts.color_mode === 'color' &&
      !isCapabilitySupported(profile, 'color_a4', true)
    ) {
      throw new PrintQuoteError(
        'Color printing is not enabled for this shop.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    if (
      normalizedOpts.duplex &&
      !isCapabilitySupported(profile, 'duplex', true)
    ) {
      throw new PrintQuoteError(
        'Double-sided (duplex) printing is not supported by this shop.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    if (
      normalizedOpts.paper_size === 'A3' &&
      !isCapabilitySupported(profile, 'a3_large', true)
    ) {
      throw new PrintQuoteError(
        'A3 / large-format printing is not supported by this shop.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    if (
      normalizedOpts.binding &&
      !isCapabilitySupported(profile, 'spiral_binding', true)
    ) {
      throw new PrintQuoteError(
        'Spiral binding is not offered by this shop.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    if (
      normalizedOpts.lamination &&
      !isCapabilitySupported(profile, 'lamination', true)
    ) {
      throw new PrintQuoteError(
        'Lamination is not offered by this shop.',
        'CAPABILITY_UNSUPPORTED'
      );
    }

    const sourcePages = Math.max(
      1,
      Math.floor(Number(file.server_verified_pages || 1))
    );
    const { normalizedRange, selectedPages } = parsePageRangeCount(
      normalizedOpts.page_range,
      sourcePages
    );
    normalizedOpts.page_range = normalizedRange;

    const sidesPerCopy = Math.ceil(selectedPages / normalizedOpts.pages_per_sheet);
    const logicalSides = sidesPerCopy * normalizedOpts.copies;
    const physicalSheets = normalizedOpts.duplex
      ? Math.ceil(sidesPerCopy / 2) * normalizedOpts.copies
      : logicalSides;

    const unitRate = resolveUnitPrintRateInr(profile, normalizedOpts);
    const filePrintSubtotal = roundInr(logicalSides * unitRate);

    const bindingFee = normalizedOpts.binding
      ? roundInr(spiralBindingRate * normalizedOpts.copies)
      : 0;
    const laminationFee = normalizedOpts.lamination
      ? roundInr(laminationPerSheetRate * physicalSheets)
      : 0;
    const stapleFee = normalizedOpts.staple
      ? roundInr(stapleRate * normalizedOpts.copies)
      : 0;
    const fileFinishingTotal = roundInr(bindingFee + laminationFee + stapleFee);
    const lineTotal = roundInr(filePrintSubtotal + fileFinishingTotal);

    totalSelectedPages += selectedPages * normalizedOpts.copies;
    totalLogicalSides += logicalSides;
    totalPhysicalSheets += physicalSheets;
    printSubtotal = roundInr(printSubtotal + filePrintSubtotal);
    finishingTotal = roundInr(finishingTotal + fileFinishingTotal);

    fileBreakdowns.push({
      file_id: file.id,
      display_label_masked: file.display_label_masked,
      source_pages: sourcePages,
      selected_pages: selectedPages,
      pages_per_sheet: normalizedOpts.pages_per_sheet,
      copies: normalizedOpts.copies,
      logical_sides: logicalSides,
      physical_sheets: physicalSheets,
      options: normalizedOpts,
      unit_rate_inr: unitRate,
      print_subtotal_inr: filePrintSubtotal,
      binding_fee_inr: bindingFee,
      lamination_fee_inr: laminationFee,
      staple_fee_inr: stapleFee,
      finishing_total_inr: fileFinishingTotal,
      line_total_inr: lineTotal,
    });
  }

  const bulkDiscountPercent = resolveBulkDiscountPercent(
    profile,
    totalLogicalSides
  );
  const bulkDiscountInr =
    bulkDiscountPercent > 0
      ? roundInr((printSubtotal * bulkDiscountPercent) / 100)
      : 0;

  const sealedEnvelopeFeeInr = sealedEnvelopeRequested ? sealedEnvelopeRate : 0;

  const preFloorTotal = roundInr(
    Math.max(0, printSubtotal - bulkDiscountInr) +
      finishingTotal +
      sealedEnvelopeFeeInr
  );

  const minOrderAdjustmentInr =
    jobMode === 'instant_print' && minOrderInr > 0 && preFloorTotal < minOrderInr
      ? roundInr(minOrderInr - preFloorTotal)
      : 0;

  const totalAmountInr = roundInr(
    preFloorTotal + minOrderAdjustmentInr + platformFeeInr
  );

  const dualRail = resolveDualRailPaymentPolicy({
    profile,
    handoverMode,
    totalAmountInr,
    customerNoShowCount,
  });

  const quoteSnapshot: PrintQuoteSnapshot = {
    pricing_version: Number(profile.pricing_version || 1),
    calculated_at: new Date().toISOString(),
    currency: 'INR',
    job_mode: jobMode,
    handover_mode: handoverMode,
    sealed_envelope_requested: sealedEnvelopeRequested,
    files: fileBreakdowns,
    total_selected_pages: totalSelectedPages,
    total_logical_sides: totalLogicalSides,
    total_physical_sheets: totalPhysicalSheets,
    print_subtotal_inr: printSubtotal,
    bulk_discount_percent: bulkDiscountPercent,
    bulk_discount_inr: bulkDiscountInr,
    finishing_total_inr: finishingTotal,
    sealed_envelope_fee_inr: sealedEnvelopeFeeInr,
    min_order_adjustment_inr: minOrderAdjustmentInr,
    platform_fee_inr: platformFeeInr,
    total_amount_inr: totalAmountInr,
    allowed_payment_rails: dualRail.allowedPaymentRails,
    forced_escrow: dualRail.forcedEscrow,
    forced_escrow_reason: dualRail.forcedEscrowReason,
  };

  return {
    quoteSnapshot,
    allowedPaymentRails: dualRail.allowedPaymentRails,
    forcedEscrow: dualRail.forcedEscrow,
    forcedEscrowReason: dualRail.forcedEscrowReason,
    railReason: dualRail.railReason,
  };
}
