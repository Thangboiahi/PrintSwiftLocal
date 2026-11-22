/**
 * Unified Context-Rich WhatsApp Handoff Utility (Pass V6-A)
 *
 * Centralizes phone normalization, safe URL generation, and structured
 * multi-line message templates so every WhatsApp CTA across DD oodle
 * prefills concise, relevant context.
 */

export type WhatsAppMessageContext =
  | {
      type: 'chatbot_support';
      hub?: string | null;
      path?: string | null;
      userName?: string | null;
      userText: string;
    }
  | {
      type: 'delivery_otp';
      code: string;
      otp: string;
      pickup: string;
      dropoff: string;
      url?: string | null;
    }
  | {
      type: 'listing_enquiry';
      listingTitle: string;
      locality?: string | null;
      hub?: string | null;
      url?: string | null;
      customNote?: string | null;
    }
  | {
      type: 'order_support';
      vertical: string;
      code: string;
      listingTitle?: string | null;
      hub?: string | null;
      status?: string | null;
      note?: string | null;
    }
  | {
      type: 'partner_callback';
      hub?: string | null;
      applicationType: string;
      applicationCode: string;
      fullName: string;
      note?: string | null;
    }
  | {
      type: 'referral_invite';
      hub?: string | null;
      code: string;
      url: string;
    };

function cleanSingleLine(value: string | null | undefined, fallback = ''): string {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function sanitizePublicUrl(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return '';
}

/**
 * Strips spaces, symbols, and leading zeros from phone numbers and normalizes
 * 10-digit Indian mobile numbers to the `91XXXXXXXXXX` international format.
 */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  let digits = raw.replace(/\D+/g, '');
  if (!digits) return '';

  // Strip international exit prefix `00`
  if (digits.startsWith('00') && digits.length > 10) {
    digits = digits.slice(2);
  }

  // Convert 11-digit Indian number with leading 0 (e.g., 09876543210 -> 919876543210)
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }

  // Standard 10-digit Indian mobile number -> prepend 91
  if (digits.length === 10) {
    return `91${digits}`;
  }

  // Reject clearly invalid tiny strings
  if (digits.length < 7) {
    return '';
  }

  return digits;
}

/**
 * Builds a clean `https://wa.me/...` deep link with URL-encoded text.
 * If `phone` is blank, generates a recipient-free share link (`https://wa.me/?text=...`).
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string
): string {
  const digits = normalizeWhatsAppPhone(phone);
  const trimmedMessage = String(message || '').trim();
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  if (!trimmedMessage) {
    return base;
  }
  return `${base}?text=${encodeURIComponent(trimmedMessage)}`;
}

/**
 * Generates standardized, concise, context-rich WhatsApp messages across all DD oodle flows.
 */
export function buildContextualWhatsAppMessage(
  context: WhatsAppMessageContext
): string {
  switch (context.type) {
    case 'chatbot_support': {
      const hub = cleanSingleLine(context.hub, 'Default Hub');
      const path = cleanSingleLine(context.path, '/');
      const user = cleanSingleLine(context.userName, 'Guest');
      const userText = String(context.userText || '').trim() || 'Need help with DD oodle.';
      return `[DD oodle Support] Hub: ${hub} | Page: ${path} | User: ${user}\nMessage: ${userText}`;
    }

    case 'delivery_otp': {
      const code = cleanSingleLine(context.code, 'Order');
      const otp = cleanSingleLine(context.otp, '------');
      const pickup = cleanSingleLine(context.pickup, 'Pickup Point');
      const dropoff = cleanSingleLine(context.dropoff, 'Dropoff Point');
      const url = sanitizePublicUrl(context.url);
      const trackSegment = url ? ` | Track: ${url}` : '';
      return `[DD oodle Pick N Drop] Order #${code} | Dropoff OTP: ${otp} | Pickup: ${pickup} -> Dropoff: ${dropoff}${trackSegment}`;
    }

    case 'listing_enquiry': {
      const title = cleanSingleLine(context.listingTitle, 'your listing');
      const locality = cleanSingleLine(context.locality);
      const hub = cleanSingleLine(context.hub);
      const locParts = [locality, hub].filter(Boolean).join(', ');
      const locLabel = locParts ? ` (${locParts})` : '';
      const url = sanitizePublicUrl(context.url);
      const note = cleanSingleLine(context.customNote);
      const base = `[DD oodle] Hi ${title}${locLabel}, I found you on DD oodle and would like to enquire${url ? `: ${url}` : '.'}`;
      return note ? `${base}\nNote: ${note}` : base;
    }

    case 'order_support': {
      const vertical = cleanSingleLine(context.vertical, 'Support');
      const code = cleanSingleLine(context.code, 'N/A');
      const title = cleanSingleLine(context.listingTitle, 'DD oodle');
      const hub = cleanSingleLine(context.hub);
      const status = cleanSingleLine(context.status, 'Active');
      const note = cleanSingleLine(context.note);
      const titleWithHub = hub ? `${title} (${hub})` : title;
      const line1 = `[DD oodle ${vertical}] Order/Booking #${code} | ${titleWithHub} | Status: ${status}`;
      return note ? `${line1}\nMessage: ${note}` : line1;
    }

    case 'partner_callback': {
      const hub = cleanSingleLine(context.hub, 'Local');
      const appType = cleanSingleLine(
        context.applicationType.replace(/_/g, ' '),
        'partner'
      );
      const code = cleanSingleLine(context.applicationCode, 'Pending');
      const fullName = cleanSingleLine(context.fullName, 'Applicant');
      const note = cleanSingleLine(context.note);
      const base = `[DD oodle ${hub} Team] Regarding your ${appType} application (${code}) for ${fullName}`;
      return note ? `${base}:\n${note}` : `${base}...`;
    }

    case 'referral_invite': {
      const hub = cleanSingleLine(context.hub, 'your city');
      const code = cleanSingleLine(context.code).toUpperCase();
      const url = sanitizePublicUrl(context.url) || cleanSingleLine(context.url);
      return `Try DD oodle in ${hub} for local maps, Pick N Drop, food, print & stays! Use my referral code ${code} when signing up: ${url}`;
    }
  }
}

/**
 * Convenience helper combining `buildContextualWhatsAppMessage` and `buildWhatsAppUrl`.
 */
export function buildContextualWhatsAppUrl(
  phone: string | null | undefined,
  context: WhatsAppMessageContext
): string {
  return buildWhatsAppUrl(phone, buildContextualWhatsAppMessage(context));
}
