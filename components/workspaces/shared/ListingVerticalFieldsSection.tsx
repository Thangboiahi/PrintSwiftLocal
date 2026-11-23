'use client';

import React from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import {
  BOOKING_UNITS,
  HOTEL_STAY_TYPES,
  type BookingUnit,
  type HotelStayType,
} from '@/lib/bookings/types';
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
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]';
const LABEL_CLASS =
  'block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1';

export function ListingVerticalFieldsSection({
  vertical,
  bundle,
  onChangeBundle,
  isPrivilegedOfficialRole,
}: ListingVerticalFieldsSectionProps) {
  if (vertical === 'print_digital') {
    const p = bundle.print;
    const setPrint = (patch: Partial<typeof p>) =>
      onChangeBundle({ ...bundle, print: { ...p, ...patch } });

    return (
      <div className="space-y-4">
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
                  Official PrintSwift Hub Flag (Admin / Hub Manager Only)
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Marks this printer as an official first-party PrintSwift hub on
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
    );
  }

  if (vertical === 'hotel_stay') {
    const h = bundle.hotel;
    const setHotel = (patch: Partial<typeof h>) =>
      onChangeBundle({ ...bundle, hotel: { ...h, ...patch } });

    return (
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
    );
  }

  if (vertical === 'shop_catalogue') {
    const s = bundle.shop;
    const setShop = (patch: Partial<typeof s>) =>
      onChangeBundle({ ...bundle, shop: { ...s, ...patch } });

    return (
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
    );
  }

  if (vertical === 'restaurant_food') {
    const r = bundle.restaurant;
    const setRest = (patch: Partial<typeof r>) =>
      onChangeBundle({ ...bundle, restaurant: { ...r, ...patch } });

    return (
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
    );
  }

  if (vertical === 'real_estate') {
    const re = bundle.realEstate;
    const setRe = (patch: Partial<typeof re>) =>
      onChangeBundle({ ...bundle, realEstate: { ...re, ...patch } });

    return (
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
          <div>
            <label className={LABEL_CLASS}>Area (sq. ft.)</label>
            <input
              type="number"
              min={0}
              value={re.areaSqft}
              onChange={(e) => {
                const sqft = Number(e.target.value) || 0;
                setRe({
                  areaSqft: sqft,
                  plotAreaSqm: Math.round(sqft / 10.7639104),
                });
              }}
              className={INPUT_CLASS}
            />
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
              <input
                type="text"
                value={hp.phone}
                onChange={(e) => {
                  const next = c.helplines.map((row, i) =>
                    i === idx ? { ...row, phone: e.target.value } : row
                  );
                  setCivic({ helplines: next });
                }}
                placeholder="Phone number"
                className={INPUT_CLASS}
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
  );
}
