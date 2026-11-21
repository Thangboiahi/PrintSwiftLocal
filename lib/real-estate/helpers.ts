/**
 * DD oodle — Phase 75-B: Client-safe Pure Real Estate Helpers
 * Indian price formatting, privacy-preserving deterministic pin offset,
 * and 30-day freshness state calculation.
 */

import type { RealEstatePricePeriod } from '@/lib/real-estate/types';

export type PropertyFreshnessState = 'fresh' | 'expiring_soon' | 'stale';

/**
 * Formats Indian property prices crisply:
 * - Rent/Lease monthly: `₹11,000/mo`
 * - Yearly: `₹1.2L/yr` or `₹85,000/yr`
 * - Total sale: `₹28.5L`, `₹1.2Cr`, `₹95,000`
 */
export function formatIndianPropertyPrice(
  priceInr: number,
  period: RealEstatePricePeriod = 'total'
): string {
  const amount = Number.isFinite(priceInr) ? Math.max(0, priceInr) : 0;
  const suffix =
    period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : '';

  if (amount >= 10_000_000) {
    const cr = amount / 10_000_000;
    const formatted = cr % 1 === 0 ? cr.toFixed(0) : Number(cr.toFixed(2)).toString();
    return `₹${formatted}Cr${suffix}`;
  }

  if (amount >= 100_000) {
    const lakh = amount / 100_000;
    const formatted =
      lakh % 1 === 0 ? lakh.toFixed(0) : Number(lakh.toFixed(2)).toString();
    return `₹${formatted}L${suffix}`;
  }

  return `₹${Math.round(amount).toLocaleString('en-IN')}${suffix}`;
}

/**
 * When `showExactPin === false`, applies a deterministic hash-based ~180m
 * neighborhood offset so the map pin stays in the right locality without
 * exposing the exact house doorstep.
 */
export function getApproximatePinCoords(
  listingId: string,
  lat: number,
  lng: number,
  showExactPin: boolean
): { lat: number; lng: number; isApproximate: boolean } {
  if (showExactPin || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { lat, lng, isApproximate: false };
  }

  // Deterministic FNV-1a-style hash of listingId
  let h1 = 2166136261;
  for (let i = 0; i < listingId.length; i++) {
    h1 ^= listingId.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
  }
  const unsigned = h1 >>> 0;

  // Deterministic angle (0..2π) and radius (~140m..210m, centered around ~180m)
  const angleRad = ((unsigned % 3600) / 3600) * Math.PI * 2;
  const radiusMeters = 150 + ((unsigned >>> 12) % 61); // 150m - 210m (~180m avg)

  const metersPerDegLat = 111_320;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const metersPerDegLng = metersPerDegLat * cosLat;

  const dLat = (Math.sin(angleRad) * radiusMeters) / metersPerDegLat;
  const dLng = (Math.cos(angleRad) * radiusMeters) / metersPerDegLng;

  return {
    lat: Number((lat + dLat).toFixed(6)),
    lng: Number((lng + dLng).toFixed(6)),
    isApproximate: true,
  };
}

/**
 * Computes 30-day listing freshness state:
 * - `'stale'`: past expiry
 * - `'expiring_soon'`: within 5 days of expiry
 * - `'fresh'`: more than 5 days remaining
 */
export function getFreshnessState(
  freshnessExpiresAt?: string | null,
  nowMs: number = Date.now()
): PropertyFreshnessState {
  if (!freshnessExpiresAt) return 'fresh';
  const expMs = Date.parse(freshnessExpiresAt);
  if (Number.isNaN(expMs)) return 'fresh';

  const diffMs = expMs - nowMs;
  if (diffMs <= 0) return 'stale';

  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  if (diffMs <= FIVE_DAYS_MS) return 'expiring_soon';
  return 'fresh';
}
