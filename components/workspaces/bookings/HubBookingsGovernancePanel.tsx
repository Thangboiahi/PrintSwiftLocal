'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  formatBookingInr,
  formatIstDateTime,
  getAmenityLabel,
  getHotelStayTypeLabel,
} from '@/lib/bookings/client-helpers';
import type {
  HotelAmenities,
  HotelPaymentPolicy,
  ListingHotelProfile,
  ResourceBooking,
} from '@/lib/bookings/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface HubBookingsGovernancePanelProps {
  hubId: string;
  hubName: string;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

interface HydratedHotelRow extends ListingHotelProfile {
  listingTitle: string;
  listingLocality: string;
}

interface HydratedHubBookingRow extends ResourceBooking {
  listingTitle: string;
  resourceName: string;
}

export function HubBookingsGovernancePanel({
  hubId,
  hubName,
  onNotice,
}: HubBookingsGovernancePanelProps) {
  const { setStatus } = useAppStatus();
  const [isLoading, setIsLoading] = useState(false);
  const [hotels, setHotels] = useState<HydratedHotelRow[]>([]);
  const [bookings, setBookings] = useState<HydratedHubBookingRow[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Filters
  const [hotelSearch, setHotelSearch] = useState('');
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>('all');

  const emit = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      onNotice?.({ type, text });
      setStatus(type === 'info' ? 'idle' : type, text);
    },
    [onNotice, setStatus]
  );

  const loadData = useCallback(async () => {
    if (!hubId || !isSupabaseConfigured()) return;
    setIsLoading(true);
    try {
      const [hotelRes, bookRes] = await Promise.all([
        supabase
          .from('listing_hotel_profiles')
          .select('*, listings(id, title, locality)')
          .eq('hub_id', hubId)
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('resource_bookings')
          .select(
            '*, listings(id, title), listing_booking_resources(id, name)'
          )
          .eq('hub_id', hubId)
          .order('created_at', { ascending: false })
          .limit(150),
      ]);

      if (Array.isArray(hotelRes.data)) {
        const mappedHotels: HydratedHotelRow[] = (
          hotelRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          return {
            ...(row as unknown as ListingHotelProfile),
            amenities: (row.amenities || {}) as HotelAmenities,
            verified_amenities: (row.verified_amenities || {}) as Record<
              string,
              boolean
            >,
            payment_policy: (row.payment_policy || {}) as HotelPaymentPolicy,
            listingTitle: String(listingRaw?.title || 'Hotel / Stay').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(listingRaw?.locality || ''),
          };
        });
        setHotels(mappedHotels);
      }

      if (Array.isArray(bookRes.data)) {
        const mappedBookings: HydratedHubBookingRow[] = (
          bookRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          const resRaw = Array.isArray(row.listing_booking_resources)
            ? (row.listing_booking_resources[0] as
                | Record<string, unknown>
                | undefined)
            : (row.listing_booking_resources as
                | Record<string, unknown>
                | undefined);
          return {
            ...(row as unknown as ResourceBooking),
            total_amount_inr: Number(row.total_amount_inr || 0),
            advance_amount_inr: Number(row.advance_amount_inr || 0),
            balance_at_venue_inr: Number(row.balance_at_venue_inr || 0),
            listingTitle: String(listingRaw?.title || 'Listing').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            resourceName: String(resRaw?.name || 'Resource'),
          };
        });
        setBookings(mappedBookings);
      }
    } catch (err) {
      emit(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to load hub bookings governance data.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [hubId, emit]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleVerifiedAmenity = async (
    hotel: HydratedHotelRow,
    amenityKey: string
  ) => {
    const keyId = `${hotel.listing_id}:${amenityKey}`;
    setSavingKey(keyId);
    try {
      const nextVerified = {
        ...(hotel.verified_amenities || {}),
        [amenityKey]: !hotel.verified_amenities?.[amenityKey],
      };
      const { error } = await supabase
        .from('listing_hotel_profiles')
        .update({
          verified_amenities: nextVerified,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', hotel.listing_id);
      if (error) throw error;
      setHotels((prev) =>
        prev.map((h) =>
          h.listing_id === hotel.listing_id
            ? { ...h, verified_amenities: nextVerified }
            : h
        )
      );
      emit(
        'success',
        `${getAmenityLabel(amenityKey)} ${
          nextVerified[amenityKey] ? 'verified' : 'unverified'
        } for ${hotel.listingTitle}.`
      );
    } catch (err) {
      emit(
        'error',
        err instanceof Error ? err.message : 'Failed to update amenity check.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const handleToggleUpiVerified = async (hotel: HydratedHotelRow) => {
    const keyId = `${hotel.listing_id}:upi`;
    setSavingKey(keyId);
    try {
      const nextPolicy: HotelPaymentPolicy = {
        ...hotel.payment_policy,
        shop_upi_verified: !hotel.payment_policy?.shop_upi_verified,
      };
      const { error } = await supabase
        .from('listing_hotel_profiles')
        .update({
          payment_policy: nextPolicy,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', hotel.listing_id);
      if (error) throw error;
      setHotels((prev) =>
        prev.map((h) =>
          h.listing_id === hotel.listing_id
            ? { ...h, payment_policy: nextPolicy }
            : h
        )
      );
      emit(
        'success',
        `UPI ${nextPolicy.shop_upi_verified ? 'verified' : 'unverified'} for ${
          hotel.listingTitle
        }.`
      );
    } catch (err) {
      emit(
        'error',
        err instanceof Error ? err.message : 'Failed to update UPI status.'
      );
    } finally {
      setSavingKey(null);
    }
  };

  const filteredHotels = useMemo(() => {
    const q = hotelSearch.trim().toLowerCase();
    if (!q) return hotels;
    return hotels.filter(
      (h) =>
        h.listingTitle.toLowerCase().includes(q) ||
        h.listingLocality.toLowerCase().includes(q) ||
        h.stay_type.toLowerCase().includes(q) ||
        (h.payment_policy?.shop_upi_id || '').toLowerCase().includes(q)
    );
  }, [hotels, hotelSearch]);

  const filteredBookings = useMemo(() => {
    const q = bookingSearch.trim().toLowerCase();
    return bookings.filter((b) => {
      if (
        bookingStatusFilter !== 'all' &&
        b.booking_status !== bookingStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        b.booking_code.toLowerCase().includes(q) ||
        b.listingTitle.toLowerCase().includes(q) ||
        b.resourceName.toLowerCase().includes(q) ||
        b.guest_name.toLowerCase().includes(q)
      );
    });
  }, [bookings, bookingSearch, bookingStatusFilter]);

  return (
    <div
      data-testid="hub-bookings-governance-panel"
      className="space-y-6 min-w-0 max-w-full"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-[var(--ps-text)] flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>Bookings &amp; Stays Governance — {hubName}</span>
          </h3>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Verify local hotel amenities &amp; UPI handles, and monitor live hub
            venue/stay reservations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={isLoading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Section 1: Local Hotel Amenity & UPI Verification */}
      <section className="space-y-3 min-w-0">
        <div className="flex items-center gap-2">
          <BedDouble className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
            1. Local Hotel Amenity &amp; UPI Verification
          </h4>
        </div>

        <WorkspaceTableToolbar
          searchQuery={hotelSearch}
          onSearchChange={setHotelSearch}
          searchPlaceholder="Search property, locality, stay type, or UPI…"
          filteredCount={filteredHotels.length}
          totalCount={hotels.length}
          countLabel="properties"
          hasActiveFilters={hotelSearch.trim().length > 0}
          onResetFilters={() => setHotelSearch('')}
        />

        <ResponsiveTableScroll minWidthClass="min-w-[820px]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
              <tr>
                <th className="px-3 py-2.5">Property &amp; Type</th>
                <th className="px-3 py-2.5">
                  Claimed Amenities (Click to Verify)
                </th>
                <th className="px-3 py-2.5">Property UPI</th>
                <th className="px-3 py-2.5 text-right">UPI Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/70">
              {filteredHotels.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No hotel/homestay profiles found in {hubName}.
                  </td>
                </tr>
              ) : (
                filteredHotels.map((h) => {
                  const claimedKeys = Object.entries(h.amenities || {})
                    .filter(([, enabled]) => Boolean(enabled))
                    .map(([k]) => k);
                  const upiVerified = Boolean(
                    h.payment_policy?.shop_upi_verified
                  );
                  return (
                    <tr
                      key={h.listing_id}
                      className="hover:bg-[var(--ps-bg)]/40 align-top"
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-[var(--ps-text)]">
                          {h.listingTitle}
                        </p>
                        <p className="text-[10px] text-[var(--ps-text-muted)]">
                          {getHotelStayTypeLabel(h.stay_type)} ·{' '}
                          {h.listingLocality}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        {claimedKeys.length === 0 ? (
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            No amenities claimed
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {claimedKeys.map((k) => {
                              const verified = Boolean(
                                h.verified_amenities?.[k]
                              );
                              const busy =
                                savingKey === `${h.listing_id}:${k}`;
                              return (
                                <button
                                  key={k}
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleToggleVerifiedAmenity(h, k)
                                  }
                                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold transition ${
                                    verified
                                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                                      : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20'
                                  }`}
                                >
                                  {busy ? (
                                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  ) : verified ? (
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                  ) : (
                                    <ShieldCheck className="h-2.5 w-2.5" />
                                  )}
                                  <span>{getAmenityLabel(k)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px]">
                        {h.payment_policy?.shop_upi_id || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={savingKey === `${h.listing_id}:upi`}
                          onClick={() => void handleToggleUpiVerified(h)}
                          className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-bold transition ${
                            upiVerified
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-emerald-500'
                          }`}
                        >
                          {savingKey === `${h.listing_id}:upi` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <BadgeCheck className="h-3 w-3" />
                          )}
                          <span>
                            {upiVerified ? 'UPI Verified ✓' : 'Verify UPI'}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </section>

      {/* Section 2: Hub Bookings Overview (Read-Only) */}
      <section className="space-y-3 min-w-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
            2. Hub Bookings Overview (Read-Only)
          </h4>
        </div>

        <WorkspaceTableToolbar
          searchQuery={bookingSearch}
          onSearchChange={setBookingSearch}
          searchPlaceholder="Search booking code, venue/hotel, or guest…"
          filteredCount={filteredBookings.length}
          totalCount={bookings.length}
          countLabel="bookings"
          hasActiveFilters={
            bookingSearch.trim().length > 0 || bookingStatusFilter !== 'all'
          }
          onResetFilters={() => {
            setBookingSearch('');
            setBookingStatusFilter('all');
          }}
        >
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                'all',
                'confirmed',
                'checked_in',
                'blocked',
                'pending_payment',
                'completed',
                'cancelled',
              ] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setBookingStatusFilter(st)}
                className={`h-7 rounded-md px-2 text-[10px] font-semibold capitalize ${
                  bookingStatusFilter === st
                    ? 'bg-slate-900 text-white dark:bg-theme-primary dark:text-[hsl(var(--color-primary-foreground))]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                }`}
              >
                {st.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll minWidthClass="min-w-[820px]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
              <tr>
                <th className="px-3 py-2.5">Code</th>
                <th className="px-3 py-2.5">Listing / Resource</th>
                <th className="px-3 py-2.5">Guest</th>
                <th className="px-3 py-2.5">Window</th>
                <th className="px-3 py-2.5">Total / Advance</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/70">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No bookings found for {hubName}.
                  </td>
                </tr>
              ) : (
                filteredBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--ps-bg)]/40">
                    <td className="px-3 py-2.5 font-mono font-bold">
                      {b.booking_source === 'walk_in_block'
                        ? 'WALK-IN'
                        : b.booking_code}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-[var(--ps-text)]">
                        {b.listingTitle}
                      </p>
                      <p className="text-[10px] text-[var(--ps-text-muted)]">
                        {b.resourceName} · {b.units_booked} unit(s)
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold">{b.guest_name}</p>
                      <p className="text-[10px] text-[var(--ps-text-muted)]">
                        {b.guest_phone || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[11px]">
                      {formatIstDateTime(b.start_at)} →{' '}
                      {formatIstDateTime(b.end_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                      {formatBookingInr(b.total_amount_inr)}{' '}
                      <span className="text-[10px] text-[var(--ps-text-muted)]">
                        (Adv {formatBookingInr(b.advance_amount_inr)})
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold uppercase">
                        {b.booking_status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </section>
    </div>
  );
}

export default HubBookingsGovernancePanel;
