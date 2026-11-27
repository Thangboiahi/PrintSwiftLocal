'use client';

import React from 'react';
import Link from 'next/link';
import { Check, Lock, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import {
  BOOKING_UNITS,
  HOTEL_STAY_TYPES,
  type BookingUnit,
  type HotelStayType,
} from '@/lib/bookings/types';
import {
  convertAreaToSqft,
  convertSqftToUnit,
  formatAreaEquivalentHint,
  PAY_PER_AREA_UNIT_LABELS,
  type PayPerAreaUnit,
} from '@/lib/monetization/pay-per';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import type {
  PattaStatus,
  RealEstateContactRevealPolicy,
  RealEstateDealType,
  RealEstateFurnishing,
  RealEstateListedByRole,
  RealEstatePricePeriod,
  RealEstatePropertyType,
  RoadAccessType,
  WaterSupplyType,
} from '@/lib/real-estate/types';
import {
  CIVIC_DEPARTMENT_TYPES,
  type CivicDepartmentType,
  type ListingVertical,
} from '@/lib/verticals/types';
import type { PrintTurnaroundBadge } from '@/lib/print-orders/types';
import type { VerticalFormBundle } from './listingVerticalProfiles';

export interface ListingVerticalFieldsSectionProps {
  vertical: ListingVertical;
  bundle: VerticalFormBundle;
  onChangeBundle: (next: VerticalFormBundle) => void;
  isPrivilegedOfficialRole: boolean;
  canUseFeature?: (featureKey: string) => boolean;
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]';
const LABEL_CLASS =
  'block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1';

interface IntegratedFeatureToggleItem {
  id: string;
  label: string;
  description: string;
  entitled: boolean;
  planHint: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

function VerticalFeatureIntegrationsCard({
  vertical,
  bundle,
  onChangeBundle,
  isPrivilegedOfficialRole,
  canUseFeature,
}: ListingVerticalFieldsSectionProps) {
  if (vertical === 'public_civic') return null;

  const isEntitled = (featureKey?: string): boolean => {
    if (!featureKey) return true;
    if (isPrivilegedOfficialRole) return true;
    if (vertical === 'print_digital' && bundle.print.isOfficialPrintswift) {
      return true;
    }
    return canUseFeature ? canUseFeature(featureKey) : true;
  };

  let items: IntegratedFeatureToggleItem[] = [];

  if (vertical === 'print_digital') {
    const p = bundle.print;
    const setPrint = (patch: Partial<typeof p>) =>
      onChangeBundle({ ...bundle, print: { ...p, ...patch } });
    items = [
      {
        id: 'print_online_ordering',
        label: 'Online Print Ordering',
        description: 'Accept live PDF/image print jobs at /listing/[id]/print',
        entitled: isEntitled('print_online_orders'),
        planHint: 'Print Pro Plan',
        checked: p.isAcceptingOrders,
        onToggle: (next) => setPrint({ isAcceptingOrders: next }),
      },
      {
        id: 'print_express_30m',
        label: 'Express 30m Badge',
        description: 'Display high-priority 30-min turnaround SLA badge on Explore',
        entitled: isEntitled('print_online_orders'),
        planHint: 'Print Pro Plan',
        checked: p.turnaroundBadge === 'express_30m',
        onToggle: (next) =>
          setPrint({
            turnaroundBadge: next ? 'express_30m' : 'same_day',
            expressEtaMins: next ? 30 : p.expressEtaMins,
          }),
      },
      {
        id: 'print_pnd_dispatch',
        label: 'Pick N Drop Delivery Dispatch',
        description: 'Allow customers to book a Pick N Drop rider from your print counter',
        entitled: isEntitled(),
        planHint: 'Included',
        checked: p.supportsPickNDrop,
        onToggle: (next) => setPrint({ supportsPickNDrop: next }),
      },
    ];
  } else if (vertical === 'restaurant_food') {
    const r = bundle.restaurant;
    const setRest = (patch: Partial<typeof r>) =>
      onChangeBundle({ ...bundle, restaurant: { ...r, ...patch } });
    items = [
      {
        id: 'rest_online_menu',
        label: 'Online Menu Ordering',
        description: 'Enable interactive dish menu & kitchen ticket queue',
        entitled: isEntitled('restaurant_menu_ordering'),
        planHint: 'Food & Kitchen Plan',
        checked: r.isKitchenOpen,
        onToggle: (next) => setRest({ isKitchenOpen: next }),
      },
      {
        id: 'rest_table_reservations',
        label: 'Table Reservations',
        description: 'Accept scheduled dining table bookings in /bookings',
        entitled: isEntitled('restaurant_table_booking'),
        planHint: 'Food & Hospitality Plan',
        checked: r.allowTableBooking,
        onToggle: (next) => setRest({ allowTableBooking: next }),
      },
      {
        id: 'rest_pnd_delivery',
        label: 'Pick N Drop Food Delivery',
        description: 'Connect your kitchen to live Pick N Drop food riders',
        entitled: isEntitled(),
        planHint: 'Included',
        checked: r.allowPickNDrop,
        onToggle: (next) => setRest({ allowPickNDrop: next }),
      },
    ];
  } else if (vertical === 'shop_catalogue') {
    const s = bundle.shop;
    const setShop = (patch: Partial<typeof s>) =>
      onChangeBundle({ ...bundle, shop: { ...s, ...patch } });
    items = [
      {
        id: 'shop_basket_checkout',
        label: 'Online Basket Checkout',
        description: 'Enable multi-item shopping cart & direct/escrow checkout',
        entitled: isEntitled('shop_basket_checkout'),
        planHint: 'Shop Commerce Plan',
        checked: s.isAcceptingOrders,
        onToggle: (next) => setShop({ isAcceptingOrders: next }),
      },
      {
        id: 'shop_live_inventory',
        label: 'Live Inventory Sync',
        description: 'Show real-time stock counts & 1-tap out-of-stock badges',
        entitled: isEntitled('shop_basket_checkout'),
        planHint: 'Shop Commerce Plan',
        checked: s.allowCounterPickup,
        onToggle: (next) => setShop({ allowCounterPickup: next }),
      },
      {
        id: 'shop_pnd_dispatch',
        label: 'Pick N Drop Dispatch',
        description: 'Enable instant courier pickup from your shop counter',
        entitled: isEntitled(),
        planHint: 'Included',
        checked: s.allowPickNDrop,
        onToggle: (next) => setShop({ allowPickNDrop: next }),
      },
    ];
  } else if (vertical === 'booking_venue') {
    const b = bundle.booking;
    const setBook = (patch: Partial<typeof b>) =>
      onChangeBundle({ ...bundle, booking: { ...b, ...patch } });
    items = [
      {
        id: 'venue_online_slots',
        label: 'Online Slot Booking Calendar',
        description: 'Accept live hourly/session reservations with Check-In OTP',
        entitled: isEntitled('booking_slots'),
        planHint: 'Venue & Turf Plan',
        checked: b.isActive,
        onToggle: (next) => setBook({ isActive: next }),
      },
      {
        id: 'venue_walk_in_blocks',
        label: 'Walk-In Block Calendar',
        description: 'Allow desk staff to block offline/phone slots instantaneously',
        entitled: isEntitled('booking_slots'),
        planHint: 'Venue & Turf Plan',
        checked: b.advancePercent >= 0,
        onToggle: (next) => setBook({ advancePercent: next ? 30 : 0 }),
      },
      {
        id: 'venue_appear_in_bookings_hub',
        label: 'Appear in Bookings Hub',
        description: 'Feature your venue inside the unified /bookings tab',
        entitled: isEntitled('booking_slots'),
        planHint: 'Venue & Turf Plan',
        checked: b.isActive,
        onToggle: (next) => setBook({ isActive: next }),
      },
    ];
  } else if (vertical === 'hotel_stay') {
    const h = bundle.hotel;
    const setHotel = (patch: Partial<typeof h>) =>
      onChangeBundle({ ...bundle, hotel: { ...h, ...patch } });
    items = [
      {
        id: 'hotel_online_room_booking',
        label: 'Online Room & Stay Booking',
        description: 'Accept nightly stay bookings with automated date availability',
        entitled: isEntitled('hotel_multi_room'),
        planHint: 'Hotel & Homestay Plan',
        checked: h.isAcceptingBookings,
        onToggle: (next) => setHotel({ isAcceptingBookings: next }),
      },
      {
        id: 'hotel_multi_room_inventory',
        label: 'Multi-Room Inventory',
        description: 'Manage multiple room categories & parallel room counts',
        entitled: isEntitled('hotel_multi_room'),
        planHint: 'Hotel & Homestay Plan',
        checked: h.starterTotalRooms >= 1,
        onToggle: (next) =>
          setHotel({ starterTotalRooms: next ? Math.max(2, h.starterTotalRooms) : 1 }),
      },
      {
        id: 'hotel_appear_in_bookings_hub',
        label: 'Appear in Bookings Hub',
        description: 'List your stay inside the unified /bookings destination',
        entitled: isEntitled('hotel_multi_room'),
        planHint: 'Hotel & Homestay Plan',
        checked: h.isAcceptingBookings,
        onToggle: (next) => setHotel({ isAcceptingBookings: next }),
      },
    ];
  } else if (vertical === 'real_estate') {
    const re = bundle.realEstate;
    const setRe = (patch: Partial<typeof re>) =>
      onChangeBundle({ ...bundle, realEstate: { ...re, ...patch } });
    items = [
      {
        id: 're_plot_polygon',
        label: 'Zoom-in Interactive Plot Polygon',
        description: 'Morph marker into a glowing area + price boundary polygon at zoom >= 16',
        entitled: isEntitled(),
        planHint: 'Included',
        checked: re.showExactPin,
        onToggle: (next) => setRe({ showExactPin: next }),
      },
      {
        id: 're_site_visit_queue',
        label: 'Site Visit Booking Queue',
        description: 'Gate owner phone number behind approved site visit appointments',
        entitled: isEntitled('real_estate_site_visit_queue'),
        planHint: 'Real Estate Pro Plan',
        checked: re.contactRevealPolicy === 'after_visit_accept',
        onToggle: (next) =>
          setRe({
            contactRevealPolicy: next ? 'after_visit_accept' : 'direct_call',
          }),
      },
      {
        id: 're_verified_boost',
        label: 'Featured Property Boost Eligibility',
        description: 'Unlock 30-day verified freshness & priority spotlight placement',
        entitled: isEntitled('real_estate_verified_boost'),
        planHint: 'Real Estate Pro Plan',
        checked: re.availabilityStatus === 'available',
        onToggle: (next) =>
          setRe({ availabilityStatus: next ? 'available' : 'paused' }),
      },
    ];
  } else {
    const g = bundle.general;
    const setGen = (patch: Partial<typeof g>) =>
      onChangeBundle({ ...bundle, general: { ...g, ...patch } });
    items = [
      {
        id: 'gen_direct_whatsapp',
        label: 'Direct WhatsApp Enquiry',
        description: 'Enable 1-tap contextual WhatsApp & phone callback buttons',
        entitled: true,
        planHint: 'Included',
        checked: !g.deliveryInfo.toLowerCase().includes('no callback'),
        onToggle: (next) =>
          setGen({
            deliveryInfo: next
              ? 'Counter Pickup / Local Delivery & WhatsApp Callback'
              : 'In-Store Visit Only (No Callback)',
          }),
      },
      {
        id: 'gen_pnd_pickup',
        label: 'Pick N Drop Pickup Point',
        description: 'Allow customers to snap Pick N Drop Point A/B directly to your pin',
        entitled: true,
        planHint: 'Included',
        checked: !g.highlightsText.toLowerCase().includes('no courier'),
        onToggle: (next) =>
          setGen({
            highlightsText: next
              ? g.highlightsText
                  .replace(/,?\s*no courier/gi, '')
                  .trim() || 'Pick N Drop Ready, Verified Local Partner'
              : `${g.highlightsText ? `${g.highlightsText}, ` : ''}No Courier`,
          }),
      },
      {
        id: 'gen_360_showcase',
        label: '360° Virtual Showcase',
        description: 'Embed named multi-view 360° panoramic tours on your listing page',
        entitled: isEntitled(),
        planHint: 'Included',
        checked: true,
        onToggle: () => {},
      },
    ];
  }

  return (
    <div
      data-testid="integrated-dd-oodle-features-card"
      className="rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/5 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-accent)] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Integrated DD oodle Features (Based on Your Plan)
          </h4>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Toggle active platform integrations for this{' '}
            <span className="font-bold text-[var(--ps-text)]">
              {vertical.replace(/_/g, ' ')}
            </span>{' '}
            listing.
          </p>
        </div>
        <Link
          href="/onboarding?track=business"
          className="text-[11px] font-bold text-[var(--ps-accent)] hover:underline"
        >
          View Plans →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {items.map((item) => (
          <div
            key={item.id}
            data-testid={`feature-integration-${item.id}`}
            className={`rounded-xl border p-3 flex flex-col justify-between gap-2.5 transition-all ${
              !item.entitled
                ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]/60 opacity-80'
                : item.checked
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-bold text-[var(--ps-text)] leading-snug">
                  {item.label}
                </span>
                {item.entitled ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.checked}
                    data-testid={`feature-toggle-${item.id}`}
                    onClick={() => item.onToggle(!item.checked)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                      item.checked
                        ? 'bg-emerald-600'
                        : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        item.checked ? 'translate-x-4' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                    <Lock className="w-2.5 h-2.5" />
                    Locked
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[var(--ps-text-muted)] leading-snug">
                {item.description}
              </p>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[var(--ps-border)]/60 text-[10px]">
              {item.entitled ? (
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    item.checked
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-[var(--ps-text-muted)]'
                  }`}
                >
                  {item.checked ? (
                    <>
                      <Check className="w-3 h-3" /> Active on Submit
                    </>
                  ) : (
                    'Disabled'
                  )}
                </span>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <span className="text-[var(--ps-text-muted)] font-medium">
                    Requires {item.planHint}
                  </span>
                  <Link
                    href="/onboarding?track=business"
                    className="font-bold text-[var(--ps-accent)] hover:underline"
                  >
                    View Plans
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListingVerticalFieldsSection({
  vertical,
  bundle,
  onChangeBundle,
  isPrivilegedOfficialRole,
  canUseFeature,
}: ListingVerticalFieldsSectionProps) {
  const integrationsHeader = (
    <VerticalFeatureIntegrationsCard
      vertical={vertical}
      bundle={bundle}
      onChangeBundle={onChangeBundle}
      isPrivilegedOfficialRole={isPrivilegedOfficialRole}
      canUseFeature={canUseFeature}
    />
  );

  if (vertical === 'print_digital') {
    const p = bundle.print;
    const setPrint = (patch: Partial<typeof p>) =>
      onChangeBundle({ ...bundle, print: { ...p, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-[var(--ps-text)]">
                Print &amp; Digital Desk Settings
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Powers <code className="font-mono">/listing/[id]/print</code>{' '}
                online ordering &amp; Pick N Drop dispatch.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={p.isAcceptingOrders}
                onChange={(e) =>
                  setPrint({ isAcceptingOrders: e.target.checked })
                }
                className="accent-[var(--ps-accent)] w-4 h-4"
              />
              Accepting Print Orders
            </label>
          </div>

          {isPrivilegedOfficialRole && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 cursor-pointer">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  Official DD oodle Print Hub Flag (Admin / Hub Manager Only)
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Marks this printer as an official first-party DD oodle Print hub on
                  Explore and unlocks express SLA badges.
                </p>
              </div>
              <input
                type="checkbox"
                checked={p.isOfficialPrintswift}
                onChange={(e) =>
                  setPrint({ isOfficialPrintswift: e.target.checked })
                }
                className="accent-amber-500 w-4 h-4 shrink-0"
              />
            </label>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <CustomSelectModal
                label="Turnaround Speed"
                value={p.turnaroundBadge}
                onChange={(val) =>
                  setPrint({ turnaroundBadge: val as PrintTurnaroundBadge })
                }
                options={[
                  { value: 'express_30m', label: 'Express 30 Mins' },
                  { value: 'same_day', label: 'Same Day Pickup' },
                  { value: 'next_day', label: 'Next Day Batch' },
                ]}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Express ETA (Minutes)</label>
              <input
                type="number"
                min={5}
                max={480}
                value={p.expressEtaMins}
                onChange={(e) =>
                  setPrint({ expressEtaMins: Number(e.target.value) || 30 })
                }
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Max PDF Size (MB)</label>
              <input
                type="number"
                min={5}
                max={200}
                value={p.maxFileSizeMb}
                onChange={(e) =>
                  setPrint({ maxFileSizeMb: Number(e.target.value) || 25 })
                }
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            {(
              [
                ['bw_a4', 'B&W A4'],
                ['color_a4', 'Color A4'],
                ['duplex', 'Duplex (2-Side)'],
                ['a3_large', 'A3 Large'],
                ['spiral_binding', 'Spiral Binding'],
                ['lamination', 'Lamination'],
                ['sealed_envelope', 'Sealed Envelope'],
                ['custom_digital_jobs', 'Custom Digital'],
              ] as Array<[keyof typeof p.capabilities, string]>
            ).map(([key, label]) => (
              <label
                key={key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={p.capabilities[key]}
                  onChange={(e) =>
                    setPrint({
                      capabilities: {
                        ...p.capabilities,
                        [key]: e.target.checked,
                      },
                    })
                  }
                  className="accent-[var(--ps-accent)]"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLASS}>B&amp;W A4 Single (₹/pg)</label>
              <input
                type="number"
                min={1}
                value={p.bwA4SingleInr}
                onChange={(e) =>
                  setPrint({ bwA4SingleInr: Number(e.target.value) || 0 })
                }
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Color A4 Single (₹/pg)</label>
              <input
                type="number"
                min={1}
                value={p.colorA4SingleInr}
                onChange={(e) =>
                  setPrint({ colorA4SingleInr: Number(e.target.value) || 0 })
                }
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Spiral Binding (₹)</label>
              <input
                type="number"
                min={0}
                value={p.spiralBindingInr}
                onChange={(e) =>
                  setPrint({ spiralBindingInr: Number(e.target.value) || 0 })
                }
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Counter Pickup Instructions</label>
              <input
                type="text"
                value={p.pickupInstructions}
                onChange={(e) =>
                  setPrint({ pickupInstructions: e.target.value })
                }
                placeholder="e.g., First floor print desk near main gate"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Shop UPI ID (Optional)</label>
              <input
                type="text"
                value={p.shopUpiId}
                onChange={(e) => setPrint({ shopUpiId: e.target.value })}
                placeholder="shopname@upi"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[var(--ps-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={p.supportsPickNDrop}
              onChange={(e) =>
                setPrint({ supportsPickNDrop: e.target.checked })
              }
              className="accent-[var(--ps-accent)]"
            />
            Supports Pick N Drop Rider Delivery
          </label>
        </div>
      </div>
    );
  }

  if (vertical === 'booking_venue') {
    const b = bundle.booking;
    const setBooking = (patch: Partial<typeof b>) =>
      onChangeBundle({ ...bundle, booking: { ...b, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Primary Bookable Venue / Court Resource
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Synced into <code className="font-mono">listing_booking_resources</code>{' '}
              for live slot selection on <code className="font-mono">/bookings</code>.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={b.isActive}
              onChange={(e) => setBooking({ isActive: e.target.checked })}
              className="accent-[var(--ps-accent)] w-4 h-4"
            />
            Accepting Slot Bookings
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Resource / Court / Hall Name *</label>
            <input
              type="text"
              value={b.name}
              onChange={(e) => setBooking({ name: e.target.value })}
              placeholder="e.g., Main 7-a-side Turf"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <CustomSelectModal
              label="Billing Unit"
              value={b.bookingUnit}
              onChange={(v) => setBooking({ bookingUnit: v as BookingUnit })}
              options={BOOKING_UNITS.map((u) => ({
                value: u,
                label: u.replace(/_/g, ' ').toUpperCase(),
              }))}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Base Rate (₹)</label>
            <input
              type="number"
              min={0}
              value={b.baseRateInr}
              onChange={(e) =>
                setBooking({ baseRateInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Slot Duration (Minutes)</label>
            <input
              type="number"
              min={15}
              step={15}
              value={b.slotDurationMins}
              onChange={(e) =>
                setBooking({ slotDurationMins: Number(e.target.value) || 60 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Max Guests / Players</label>
            <input
              type="number"
              min={1}
              value={b.maxGuests}
              onChange={(e) =>
                setBooking({ maxGuests: Number(e.target.value) || 1 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Total Parallel Courts / Units</label>
            <input
              type="number"
              min={1}
              value={b.totalUnits}
              onChange={(e) =>
                setBooking({ totalUnits: Number(e.target.value) || 1 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Opening Hour (0–23)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={b.openHour}
              onChange={(e) =>
                setBooking({ openHour: Number(e.target.value) || 6 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Closing Hour (1–24)</label>
            <input
              type="number"
              min={1}
              max={24}
              value={b.closeHour}
              onChange={(e) =>
                setBooking({ closeHour: Number(e.target.value) || 22 })
              }
              className={INPUT_CLASS}
            />
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (vertical === 'hotel_stay') {
    const h = bundle.hotel;
    const setHotel = (patch: Partial<typeof h>) =>
      onChangeBundle({ ...bundle, hotel: { ...h, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Hotel, Homestay &amp; Stay Configuration
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Saves <code className="font-mono">listing_hotel_profiles</code> &amp;
              starter room type in{' '}
              <code className="font-mono">listing_booking_resources</code>.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={h.isAcceptingBookings}
              onChange={(e) =>
                setHotel({ isAcceptingBookings: e.target.checked })
              }
              className="accent-[var(--ps-accent)] w-4 h-4"
            />
            Accepting Stay Bookings
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <CustomSelectModal
              label="Stay Type"
              value={h.stayType}
              onChange={(v) => setHotel({ stayType: v as HotelStayType })}
              options={HOTEL_STAY_TYPES.map((t) => ({
                value: t,
                label: t.replace(/_/g, ' ').toUpperCase(),
              }))}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Check-in Time</label>
            <input
              type="text"
              value={h.checkInTime}
              onChange={(e) => setHotel({ checkInTime: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Check-out Time</label>
            <input
              type="text"
              value={h.checkOutTime}
              onChange={(e) => setHotel({ checkOutTime: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {(
            [
              ['wifi', 'Wi-Fi'],
              ['parking', 'Parking'],
              ['hot_water', 'Hot Water'],
              ['power_backup', 'Power Backup'],
              ['ac', 'AC Rooms'],
              ['heater', 'Room Heater'],
              ['in_house_kitchen', 'In-house Kitchen'],
              ['early_checkin', 'Early Check-in'],
            ] as Array<[keyof typeof h.amenities, string]>
          ).map(([k, lbl]) => (
            <label
              key={k}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={h.amenities[k]}
                onChange={(e) =>
                  setHotel({
                    amenities: { ...h.amenities, [k]: e.target.checked },
                  })
                }
                className="accent-[var(--ps-accent)]"
              />
              {lbl}
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div>
            <label className={LABEL_CLASS}>Starter Room Name</label>
            <input
              type="text"
              value={h.starterRoomName}
              onChange={(e) => setHotel({ starterRoomName: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Nightly Rate (₹)</label>
            <input
              type="number"
              min={100}
              value={h.starterNightlyRateInr}
              onChange={(e) =>
                setHotel({
                  starterNightlyRateInr: Number(e.target.value) || 0,
                })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Rooms Available</label>
            <input
              type="number"
              min={1}
              value={h.starterTotalRooms}
              onChange={(e) =>
                setHotel({ starterTotalRooms: Number(e.target.value) || 1 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Max Guests / Room</label>
            <input
              type="number"
              min={1}
              value={h.starterMaxGuests}
              onChange={(e) =>
                setHotel({ starterMaxGuests: Number(e.target.value) || 1 })
              }
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>House Rules</label>
            <input
              type="text"
              value={h.houseRules}
              onChange={(e) => setHotel({ houseRules: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Cancellation Policy</label>
            <input
              type="text"
              value={h.cancellationPolicy}
              onChange={(e) => setHotel({ cancellationPolicy: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (vertical === 'shop_catalogue') {
    const s = bundle.shop;
    const setShop = (patch: Partial<typeof s>) =>
      onChangeBundle({ ...bundle, shop: { ...s, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Shop Catalogue Storefront Rules
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Configures <code className="font-mono">listing_shop_profiles</code>{' '}
              (products are managed in the Shop &amp; Kitchen Desk).
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={s.isAcceptingOrders}
              onChange={(e) =>
                setShop({ isAcceptingOrders: e.target.checked })
              }
              className="accent-[var(--ps-accent)] w-4 h-4"
            />
            Store Accepting Orders
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLASS}>Min Order Value (₹)</label>
            <input
              type="number"
              min={0}
              value={s.minOrderInr}
              onChange={(e) =>
                setShop({ minOrderInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Packaging Fee (₹)</label>
            <input
              type="number"
              min={0}
              value={s.packagingFeeInr}
              onChange={(e) =>
                setShop({ packagingFeeInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Avg Prep Time (Mins)</label>
            <input
              type="number"
              min={5}
              value={s.prepTimeMins}
              onChange={(e) =>
                setShop({ prepTimeMins: Number(e.target.value) || 15 })
              }
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={s.allowCounterPickup}
              onChange={(e) =>
                setShop({ allowCounterPickup: e.target.checked })
              }
              className="accent-[var(--ps-accent)]"
            />
            Counter Pickup
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={s.allowPickNDrop}
              onChange={(e) => setShop({ allowPickNDrop: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Pick N Drop Delivery
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={s.allowEscrow}
              onChange={(e) => setShop({ allowEscrow: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Escrow Protection
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Pickup Instructions</label>
            <input
              type="text"
              value={s.pickupInstructions}
              onChange={(e) => setShop({ pickupInstructions: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Merchant UPI ID (Optional)</label>
            <input
              type="text"
              value={s.shopUpiId}
              onChange={(e) => setShop({ shopUpiId: e.target.value })}
              placeholder="store@upi"
              className={INPUT_CLASS}
            />
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (vertical === 'restaurant_food') {
    const r = bundle.restaurant;
    const setRest = (patch: Partial<typeof r>) =>
      onChangeBundle({ ...bundle, restaurant: { ...r, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Restaurant, Café &amp; Kitchen Profile
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Powers food ordering, takeaway, Pick N Drop delivery &amp; table
              requests.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={r.isKitchenOpen}
              onChange={(e) => setRest({ isKitchenOpen: e.target.checked })}
              className="accent-[var(--ps-accent)] w-4 h-4"
            />
            Kitchen Currently Open
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Cuisines (Comma-Separated)</label>
            <input
              type="text"
              value={r.cuisinesText}
              onChange={(e) => setRest({ cuisinesText: e.target.value })}
              placeholder="e.g., Manipuri, Momos, Fast Food, Coffee"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>FSSAI License No. (Optional)</label>
            <input
              type="text"
              value={r.fssaiLicenseNo}
              onChange={(e) => setRest({ fssaiLicenseNo: e.target.value })}
              placeholder="14-digit FSSAI number"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLASS}>Cost for Two (₹)</label>
            <input
              type="number"
              min={50}
              value={r.avgCostForTwoInr}
              onChange={(e) =>
                setRest({ avgCostForTwoInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Prep Time (Mins)</label>
            <input
              type="number"
              min={5}
              value={r.prepTimeMins}
              onChange={(e) =>
                setRest({ prepTimeMins: Number(e.target.value) || 15 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Min Order (₹)</label>
            <input
              type="number"
              min={0}
              value={r.minOrderInr}
              onChange={(e) =>
                setRest({ minOrderInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Max Table Party</label>
            <input
              type="number"
              min={1}
              value={r.maxTablePartySize}
              onChange={(e) =>
                setRest({ maxTablePartySize: Number(e.target.value) || 4 })
              }
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.isPureVeg}
              onChange={(e) => setRest({ isPureVeg: e.target.checked })}
              className="accent-emerald-500"
            />
            Pure Vegetarian
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.allowTakeaway}
              onChange={(e) => setRest({ allowTakeaway: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Takeaway
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.allowPickNDrop}
              onChange={(e) => setRest({ allowPickNDrop: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Pick N Drop Delivery
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={r.allowTableBooking}
              onChange={(e) =>
                setRest({ allowTableBooking: e.target.checked })
              }
              className="accent-[var(--ps-accent)]"
            />
            Table Reservations
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLASS}>Pickup Counter Note</label>
            <input
              type="text"
              value={r.pickupInstructions}
              onChange={(e) =>
                setRest({ pickupInstructions: e.target.value })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Kitchen UPI ID (Optional)</label>
            <input
              type="text"
              value={r.shopUpiId}
              onChange={(e) => setRest({ shopUpiId: e.target.value })}
              placeholder="kitchen@upi"
              className={INPUT_CLASS}
            />
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (vertical === 'real_estate') {
    const re = bundle.realEstate;
    const setRe = (patch: Partial<typeof re>) =>
      onChangeBundle({ ...bundle, realEstate: { ...re, ...patch } });

    return (
      <div className="space-y-4">
        {integrationsHeader}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Real Estate Property &amp; Land Specification
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Plot boundary drawn on Step 1 auto-syncs into Area (ft² / m²).
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
            {formatIndianPropertyPrice(re.priceInr, re.pricePeriod)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CustomSelectModal
            label="Deal Type"
            value={re.dealType}
            onChange={(v) =>
              setRe({
                dealType: v as RealEstateDealType,
                pricePeriod: v === 'rent' ? 'monthly' : 'total',
              })
            }
            options={[
              { value: 'sale', label: 'For Sale' },
              { value: 'rent', label: 'For Rent' },
              { value: 'lease', label: 'For Lease' },
              { value: 'pg_hostel', label: 'PG / Hostel' },
            ]}
          />
          <CustomSelectModal
            label="Property Category"
            value={re.propertyType}
            onChange={(v) =>
              setRe({ propertyType: v as RealEstatePropertyType })
            }
            options={[
              { value: 'plot_land', label: 'Plot / Land' },
              { value: 'house', label: 'Independent House / Villa' },
              { value: 'apartment', label: 'Apartment / Flat' },
              { value: 'commercial_shop', label: 'Commercial Shop / Office' },
              { value: 'room_pg', label: 'Single Room / PG' },
            ]}
          />
          <CustomSelectModal
            label="Price Period"
            value={re.pricePeriod}
            onChange={(v) =>
              setRe({ pricePeriod: v as RealEstatePricePeriod })
            }
            options={[
              { value: 'total', label: 'Total Price' },
              { value: 'monthly', label: 'Per Month (/mo)' },
              { value: 'yearly', label: 'Per Year (/yr)' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLASS}>Asking Price (₹) *</label>
            <input
              type="number"
              min={0}
              value={re.priceInr}
              onChange={(e) =>
                setRe({ priceInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Security Deposit (₹)</label>
            <input
              type="number"
              min={0}
              value={re.depositInr}
              onChange={(e) =>
                setRe({ depositInr: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CustomSelectModal
              label="Area Unit (Sangam / sq.ft / sq.m / Acre)"
              value={re.areaUnit}
              onChange={(v) => {
                const nextUnit = v as PayPerAreaUnit;
                const nextVal =
                  re.areaSqft > 0
                    ? convertSqftToUnit(re.areaSqft, nextUnit)
                    : re.areaValue;
                setRe({
                  areaUnit: nextUnit,
                  areaValue: nextVal,
                });
              }}
              options={(Object.keys(PAY_PER_AREA_UNIT_LABELS) as PayPerAreaUnit[]).map(
                (u) => ({
                  value: u,
                  label: PAY_PER_AREA_UNIT_LABELS[u],
                })
              )}
            />
            <div>
              <label className={LABEL_CLASS}>
                Property Area ({re.areaUnit.toUpperCase()})
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={re.areaValue}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0);
                  const sqft = convertAreaToSqft(val, re.areaUnit);
                  setRe({
                    areaValue: val,
                    areaSqft: sqft,
                    plotAreaSqm: Math.round(sqft / 10.7639104),
                  });
                }}
                className={INPUT_CLASS}
              />
              {re.areaSqft > 0 && (
                <p className="mt-1 text-[10px] text-[var(--ps-text-muted)]">
                  ≈ {formatAreaEquivalentHint(re.areaSqft)}
                </p>
              )}
            </div>
          </div>
          <div>
            <label className={LABEL_CLASS}>Dimensions / Label</label>
            <input
              type="text"
              value={re.landAreaText}
              onChange={(e) => setRe({ landAreaText: e.target.value })}
              placeholder="e.g., 40 × 60 ft"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={LABEL_CLASS}>Bedrooms</label>
            <input
              type="number"
              min={0}
              value={re.bedrooms}
              onChange={(e) =>
                setRe({ bedrooms: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Bathrooms</label>
            <input
              type="number"
              min={0}
              value={re.bathrooms}
              onChange={(e) =>
                setRe({ bathrooms: Number(e.target.value) || 0 })
              }
              className={INPUT_CLASS}
            />
          </div>
          <CustomSelectModal
            label="Furnishing"
            value={re.furnishing}
            onChange={(v) => setRe({ furnishing: v as RealEstateFurnishing })}
            options={[
              { value: 'not_applicable', label: 'N/A (Land / Shell)' },
              { value: 'unfurnished', label: 'Unfurnished' },
              { value: 'semi_furnished', label: 'Semi-Furnished' },
              { value: 'furnished', label: 'Fully Furnished' },
            ]}
          />
          <CustomSelectModal
            label="Patta / Title Status"
            value={re.pattaStatus}
            onChange={(v) => setRe({ pattaStatus: v as PattaStatus })}
            options={[
              { value: 'verified_patta', label: 'Verified Patta' },
              { value: 'village_authority', label: 'Village Authority' },
              { value: 'leasehold', label: 'Leasehold' },
              { value: 'not_applicable', label: 'Not Applicable' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <CustomSelectModal
            label="Water Supply"
            value={re.waterSupply}
            onChange={(v) => setRe({ waterSupply: v as WaterSupplyType })}
            options={[
              { value: '24x7', label: '24×7 Running Water' },
              { value: 'municipal', label: 'Municipal Line' },
              { value: 'borewell', label: 'Borewell' },
              { value: 'tanker', label: 'Tanker Service' },
              { value: 'seasonal', label: 'Seasonal' },
            ]}
          />
          <CustomSelectModal
            label="Road Access"
            value={re.roadAccess}
            onChange={(v) => setRe({ roadAccess: v as RoadAccessType })}
            options={[
              { value: 'car_accessible', label: 'Car Accessible Road' },
              { value: 'two_wheeler_only', label: 'Two-Wheeler Lane' },
              { value: 'footpath', label: 'Footpath' },
            ]}
          />
          <CustomSelectModal
            label="Listed By"
            value={re.listedByRole}
            onChange={(v) =>
              setRe({ listedByRole: v as RealEstateListedByRole })
            }
            options={[
              { value: 'owner', label: 'Direct Owner' },
              { value: 'agent', label: 'Verified Agent' },
              { value: 'builder', label: 'Builder / Developer' },
            ]}
          />
          <CustomSelectModal
            label="Contact Reveal Policy"
            value={re.contactRevealPolicy}
            onChange={(v) =>
              setRe({
                contactRevealPolicy: v as RealEstateContactRevealPolicy,
              })
            }
            options={[
              { value: 'direct_call', label: 'Direct Call Visible' },
              { value: 'after_visit_accept', label: 'After Visit Accepted' },
            ]}
          />
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={re.isNegotiable}
              onChange={(e) => setRe({ isNegotiable: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Price Negotiable
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={re.parkingAvailable}
              onChange={(e) => setRe({ parkingAvailable: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Parking Available
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={re.powerBackup}
              onChange={(e) => setRe({ powerBackup: e.target.checked })}
              className="accent-[var(--ps-accent)]"
            />
            Power Backup / Inverter
          </label>
        </div>
        </div>
      </div>
    );
  }

  if (vertical === 'public_civic') {
    const c = bundle.civic;
    const setCivic = (patch: Partial<typeof c>) =>
      onChangeBundle({ ...bundle, civic: { ...c, ...patch } });

    return (
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Public &amp; Government Civic Directory Record
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Managed by Hub Managers &amp; Super-Admins for{' '}
              <code className="font-mono">listing_civic_profiles</code>.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={c.is24x7}
              onChange={(e) => setCivic({ is24x7: e.target.checked })}
              className="accent-emerald-500 w-4 h-4"
            />
            24×7 Emergency / Open Always
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CustomSelectModal
            label="Civic Department Type"
            value={c.departmentType}
            onChange={(v) =>
              setCivic({ departmentType: v as CivicDepartmentType })
            }
            options={CIVIC_DEPARTMENT_TYPES.map((d) => ({
              value: d,
              label: d.replace(/_/g, ' ').toUpperCase(),
            }))}
          />
          <div>
            <label className={LABEL_CLASS}>Official Website (Optional)</label>
            <input
              type="url"
              value={c.officialWebsite}
              onChange={(e) => setCivic({ officialWebsite: e.target.value })}
              placeholder="https://..."
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>Citizen Notes &amp; Guidance</label>
          <textarea
            rows={2}
            value={c.importantNotes}
            onChange={(e) => setCivic({ importantNotes: e.target.value })}
            placeholder="Counter numbers, public holidays, token system..."
            className={INPUT_CLASS}
          />
        </div>

        {/* Helplines Repeater */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--ps-text)]">
              Helpline Numbers ({c.helplines.length})
            </span>
            <button
              type="button"
              onClick={() =>
                setCivic({
                  helplines: [
                    ...c.helplines,
                    { label: 'Help Desk', phone: '', is_emergency: false },
                  ],
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Helpline
            </button>
          </div>
          {c.helplines.map((hp, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center"
            >
              <input
                type="text"
                value={hp.label}
                onChange={(e) => {
                  const next = c.helplines.map((row, i) =>
                    i === idx ? { ...row, label: e.target.value } : row
                  );
                  setCivic({ helplines: next });
                }}
                placeholder="Desk / Helpline Label"
                className={INPUT_CLASS}
              />
              <PhoneInputWithCountry
                value={hp.phone}
                onChange={(nextPhone) => {
                  const next = c.helplines.map((row, i) =>
                    i === idx ? { ...row, phone: nextPhone } : row
                  );
                  setCivic({ helplines: next });
                }}
                placeholder="108 or 98620 00000"
                allowShortCode
                variant="sm"
                testId={`vertical-civic-helpline-phone-${idx}`}
              />
              <button
                type="button"
                onClick={() =>
                  setCivic({
                    helplines: c.helplines.filter((_, i) => i !== idx),
                  })
                }
                className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-[var(--ps-text)] cursor-pointer">
          <input
            type="checkbox"
            checked={c.showNearbyPrintHelper}
            onChange={(e) =>
              setCivic({ showNearbyPrintHelper: e.target.checked })
            }
            className="accent-[var(--ps-accent)]"
          />
          Show &ldquo;Print Forms Nearby&rdquo; Helper Card
        </label>
      </div>
    );
  }

  // General Store / Local Service
  const g = bundle.general;
  const setGen = (patch: Partial<typeof g>) =>
    onChangeBundle({ ...bundle, general: { ...g, ...patch } });

  return (
    <div className="space-y-4">
      {integrationsHeader}
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
      <div>
        <h4 className="text-sm font-bold text-[var(--ps-text)]">
          General Business &amp; Service Profile
        </h4>
        <p className="text-[11px] text-[var(--ps-text-muted)]">
          Core commercial details shown on Explore cards and Storefront pages.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <CustomSelectModal
          label="Price Tier"
          value={g.priceRange}
          onChange={(v) => setGen({ priceRange: v as '₹' | '₹₹' | '₹₹₹' })}
          options={[
            { value: '₹', label: '₹ Budget Friendly' },
            { value: '₹₹', label: '₹₹ Standard' },
            { value: '₹₹₹', label: '₹₹₹ Premium' },
          ]}
        />
        <div>
          <label className={LABEL_CLASS}>Starting Rate (₹ Optional)</label>
          <input
            type="number"
            min={0}
            value={g.startingPriceInr}
            onChange={(e) =>
              setGen({ startingPriceInr: Number(e.target.value) || 0 })
            }
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Years Active</label>
          <input
            type="number"
            min={0}
            value={g.experienceYears}
            onChange={(e) =>
              setGen({ experienceYears: Number(e.target.value) || 0 })
            }
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Fulfillment / Delivery Note</label>
          <input
            type="text"
            value={g.deliveryInfo}
            onChange={(e) => setGen({ deliveryInfo: e.target.value })}
            placeholder="e.g., Counter pickup & same-day town delivery"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Service Areas (Comma-Separated)</label>
          <input
            type="text"
            value={g.serviceAreasText}
            onChange={(e) => setGen({ serviceAreasText: e.target.value })}
            placeholder="e.g., New Lamka, Tuibong, Rengkai"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS}>Key Highlights (Comma-Separated)</label>
        <input
          type="text"
          value={g.highlightsText}
          onChange={(e) => setGen({ highlightsText: e.target.value })}
          placeholder="e.g., UPI Accepted, Home Visit, Express Service"
          className={INPUT_CLASS}
        />
      </div>
      </div>
    </div>
  );
}
