'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Bath,
  BedDouble,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock,
  Droplets,
  ExternalLink,
  Home,
  Loader2,
  Lock,
  Maximize2,
  ParkingCircle,
  PauseCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type {
  ListingRealEstateProfile,
  PropertyVisitRequest,
  PropertyVisitSlot,
} from '@/lib/real-estate/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';

export interface RealEstateDetailClientProps {
  listingId: string;
  listingTitle: string;
  listingLocality: string;
  contactPhone: string | null;
  profile: ListingRealEstateProfile;
  existingVisitRequest: PropertyVisitRequest | null;
  isModuleEnabled: boolean;
}

const PATTA_LABELS: Record<string, string> = {
  verified_patta: 'Clear Patta',
  village_authority: 'Village Authority Certificate',
  leasehold: 'Leasehold',
  not_applicable: 'Not Applicable',
};

const WATER_LABELS: Record<string, string> = {
  '24x7': '24×7 Running Water',
  municipal: 'Municipal Line',
  borewell: 'Borewell / Well',
  tanker: 'Water Tanker',
  seasonal: 'Seasonal Supply',
};

const ROAD_LABELS: Record<string, string> = {
  car_accessible: 'Car-Accessible Road',
  two_wheeler_only: 'Two-Wheeler Lane',
  footpath: 'Footpath Access',
};

const FURNISHING_LABELS: Record<string, string> = {
  unfurnished: 'Unfurnished',
  semi_furnished: 'Semi-Furnished',
  furnished: 'Fully Furnished',
  not_applicable: 'N/A',
};

const DEAL_LABELS: Record<string, string> = {
  rent: 'FOR RENT',
  sale: 'FOR SALE',
  lease: 'FOR LEASE',
  pg_hostel: 'PG / HOSTEL',
};

function getTomorrowIso(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function RealEstateDetailClient({
  listingId,
  listingTitle,
  listingLocality,
  contactPhone,
  profile,
  existingVisitRequest,
  isModuleEnabled,
}: RealEstateDetailClientProps) {
  const { user, fullName } = useAuth();
  const { setStatus } = useAppStatus();

  const [visitRecord, setVisitRecord] = useState<PropertyVisitRequest | null>(
    existingVisitRequest
  );
  const [isVisitModalOpen, setIsVisitModalOpen] = useState(false);

  const [preferredDate, setPreferredDate] = useState<string>(getTomorrowIso);
  const [preferredSlot, setPreferredSlot] =
    useState<PropertyVisitSlot>('morning');
  const [requesterName, setRequesterName] = useState<string>(
    fullName || (user?.user_metadata?.full_name as string) || ''
  );
  const [requesterPhone, setRequesterPhone] = useState<string>(
    (user?.user_metadata?.phone as string) || ''
  );
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { confirm: confirmVisit, dialog: confirmVisitDialog } =
    useConfirmDialog();

  const isBoosted = Boolean(
    profile.verified_boost_expires_at &&
      !Number.isNaN(Date.parse(profile.verified_boost_expires_at)) &&
      Date.parse(profile.verified_boost_expires_at) > Date.now()
  );

  const freshnessState = getFreshnessState(profile.freshness_expires_at);
  const canRevealContact =
    profile.contact_reveal_policy === 'direct_call' ||
    Boolean(
      visitRecord &&
        visitRecord.status === 'accepted' &&
        visitRecord.contact_revealed
    );

  const canRequestVisit =
    isModuleEnabled &&
    (profile.availability_status === 'available' ||
      profile.availability_status === 'under_offer');

  const handleSubmitVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!user) {
      setErrorMsg('Please sign in to schedule a site visit.');
      return;
    }
    if (!requesterName.trim()) {
      setErrorMsg('Please enter your name.');
      return;
    }
    if (requesterPhone.replace(/\D/g, '').length < 7) {
      setErrorMsg('Please enter a valid phone number.');
      return;
    }

    const ok = await confirmVisit({
      title: 'Confirm Site Visit Request?',
      description: `Your visit request for "${listingTitle}" will be sent to the property owner for confirmation.`,
      confirmLabel: 'Confirm & Request Visit',
      cancelLabel: 'Review',
      variant: 'default',
    });
    if (!ok) return;

    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/real-estate/visit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'create',
          listingId,
          requesterName: requesterName.trim(),
          requesterPhone: requesterPhone.trim(),
          preferredDate,
          preferredSlot,
          message: message.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        visitRequest?: PropertyVisitRequest;
        error?: string;
      };
      if (!res.ok || !json.visitRequest) {
        setErrorMsg(json.error || 'Could not submit site visit request.');
        return;
      }

      setVisitRecord(json.visitRequest);
      setIsVisitModalOpen(false);
      setStatus(
        'success',
        `Site visit requested (${json.visitRequest.request_code})!`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      data-testid="real-estate-pro-detail"
      className="space-y-4 rounded-2xl border border-violet-500/25 bg-[var(--ps-surface)] p-5 shadow-xs"
    >
      {/* Header Strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
              {DEAL_LABELS[profile.deal_type] || profile.deal_type}
            </span>
            {isBoosted && (
              <span className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-amber-500 to-violet-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <Sparkles className="h-3 w-3" />
                FEATURED
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize text-[var(--ps-text)]">
              <UserCheck className="h-3 w-3 text-violet-500" />
              {profile.listed_by_role === 'agent'
                ? 'Verified Agent'
                : profile.listed_by_role === 'builder'
                  ? 'Builder'
                  : 'Direct Owner'}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-bold capitalize ${
                profile.availability_status === 'available'
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : profile.availability_status === 'under_offer'
                    ? 'bg-amber-500/12 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {profile.availability_status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-2.5">
            <p className="font-mono text-2xl font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
              {formatIndianPropertyPrice(profile.price_inr, profile.price_period)}
            </p>
            {profile.is_negotiable && (
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                Negotiable
              </span>
            )}
            {profile.deposit_inr && Number(profile.deposit_inr) > 0 && (
              <span className="text-xs text-[var(--ps-text-muted)]">
                Deposit:{' '}
                <strong className="font-mono text-[var(--ps-text)]">
                  ₹{Number(profile.deposit_inr).toLocaleString('en-IN')}
                </strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-1.5 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-semibold ${
              freshnessState === 'stale'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>
              {freshnessState === 'stale'
                ? 'Confirm Availability with Owner'
                : `Confirmed Available · ${new Date(
                    profile.last_confirmed_available_at
                  ).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                  })}`}
            </span>
          </span>

          {profile.optional_tour_url && (
            <a
              href={profile.optional_tour_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 text-xs font-bold text-violet-700 dark:text-violet-300 hover:bg-violet-500/20"
            >
              <span>Open Virtual Tour</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Structured Specs & Regional Trust Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 text-xs">
        {profile.bedrooms !== null && profile.bedrooms > 0 && (
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Bedrooms
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
              <BedDouble className="h-3.5 w-3.5 text-violet-500" />
              <span>{profile.bedrooms} BHK</span>
            </p>
          </div>
        )}
        {profile.bathrooms !== null && profile.bathrooms > 0 && (
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Bathrooms
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
              <Bath className="h-3.5 w-3.5 text-violet-500" />
              <span>{profile.bathrooms}</span>
            </p>
          </div>
        )}
        {(profile.land_area_text || profile.area_sqft) && (
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Area / Plot Size
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
              <Maximize2 className="h-3.5 w-3.5 text-violet-500" />
              <span>
                {profile.land_area_text ||
                  `${Number(profile.area_sqft).toLocaleString('en-IN')} sq.ft`}
              </span>
            </p>
          </div>
        )}
        {profile.furnishing !== 'not_applicable' && (
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Furnishing
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
              <Home className="h-3.5 w-3.5 text-violet-500" />
              <span>{FURNISHING_LABELS[profile.furnishing] || profile.furnishing}</span>
            </p>
          </div>
        )}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Patta / Land Record
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
            <BadgeCheck
              className={`h-3.5 w-3.5 ${
                profile.patta_verified ? 'text-emerald-600' : 'text-[var(--ps-text-muted)]'
              }`}
            />
            <span>
              {PATTA_LABELS[profile.patta_status] || profile.patta_status}
              {profile.patta_verified ? ' ✓' : ''}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Water Supply
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
            <Droplets className="h-3.5 w-3.5 text-sky-500" />
            <span>{WATER_LABELS[profile.water_supply] || profile.water_supply}</span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Road Access
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
            <Car className="h-3.5 w-3.5 text-violet-500" />
            <span>{ROAD_LABELS[profile.road_access] || profile.road_access}</span>
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Utilities &amp; Parking
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-bold text-[var(--ps-text)]">
            <span className="inline-flex items-center gap-1">
              <Zap
                className={`h-3.5 w-3.5 ${
                  profile.power_backup ? 'text-amber-500' : 'opacity-30'
                }`}
              />
              {profile.power_backup ? 'Backup' : 'No Backup'}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <ParkingCircle
                className={`h-3.5 w-3.5 ${
                  profile.parking_available ? 'text-emerald-600' : 'opacity-30'
                }`}
              />
              {profile.parking_available ? 'Parking' : 'Street'}
            </span>
          </div>
        </div>
      </div>

      {/* Hub Verification Badges */}
      {(profile.patta_verified || profile.site_verified) && (
        <div className="flex flex-wrap items-center gap-2">
          {profile.patta_verified && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <BadgeCheck className="h-4 w-4" />
              <span>Hub-Verified Patta Document ✓</span>
            </span>
          )}
          {profile.site_verified && (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 py-1 text-xs font-bold text-violet-700 dark:text-violet-300">
              <ShieldCheck className="h-4 w-4" />
              <span>Hub Site Inspected ✓</span>
            </span>
          )}
        </div>
      )}

      {/* Controlled Contact & Site Visit Request Card */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
        {!isModuleEnabled ? (
          <div className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">Real Estate Visit Scheduling Temporarily Paused</p>
              <p className="text-[var(--ps-text-muted)]">
                This hub has temporarily paused new real estate visit requests. Please check back shortly.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-2">
                {canRevealContact ? (
                  <>
                    <Phone className="h-4 w-4 text-emerald-600" />
                    <span>Owner / Agent Contact Unlocked</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 text-violet-600" />
                    <span>Controlled Contact &amp; Site Visit</span>
                  </>
                )}
              </h3>
              <p className="text-xs text-[var(--ps-text-muted)]">
                {canRevealContact
                  ? visitRecord?.status === 'accepted'
                    ? `Visit ${visitRecord.request_code} accepted for ${visitRecord.preferred_date} (${visitRecord.preferred_slot}). You can call the owner directly.`
                    : 'This listing allows direct phone contact with the owner/agent.'
                  : visitRecord && visitRecord.status === 'requested'
                    ? `Visit request ${visitRecord.request_code} is pending owner confirmation (${visitRecord.preferred_date}, ${visitRecord.preferred_slot}). Phone unlocks automatically once accepted.`
                    : 'Request a preferred date & time slot. Owner phone & exact doorstep unlock once your site visit is accepted.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canRevealContact && contactPhone && (
                <a
                  href={`tel:${contactPhone}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call {contactPhone}</span>
                </a>
              )}

              {canRequestVisit &&
                (!visitRecord ||
                  visitRecord.status === 'cancelled' ||
                  visitRecord.status === 'declined') && (
                  <button
                    type="button"
                    onClick={() => setIsVisitModalOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-violet-700 cursor-pointer"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>
                      {canRevealContact
                        ? 'Schedule Site Visit'
                        : 'Request Site Visit to Unlock Contact'}
                    </span>
                  </button>
                )}

              {visitRecord && visitRecord.status === 'requested' && (
                <Link
                  href="/activity?tab=enquiries"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3.5 text-xs font-bold text-violet-700 dark:text-violet-300"
                >
                  <span>Track Visit ({visitRecord.request_code})</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cross-Vertical Shifting Flywheel Strip */}
      {(profile.deal_type === 'rent' || profile.deal_type === 'sale') && (
        <Link
          href="/vehicles"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/25 bg-sky-500/6 px-4 py-3 text-xs hover:bg-sky-500/10 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Truck className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="font-semibold text-[var(--ps-text)]">
              Moving or shifting household items? Book a local mini-van or pickup in Scheduled Vehicles
            </span>
          </div>
          <span className="inline-flex items-center gap-1 font-bold text-sky-700 dark:text-sky-300 shrink-0">
            <span>Browse Vehicles</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {/* Site Visit Request Modal (z-[88]) */}
      {isVisitModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Request Property Site Visit"
            onClick={() => setIsVisitModalOpen(false)}
          >
            <form
              onSubmit={(e) => void handleSubmitVisit(e)}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Request Site Visit
                  </h3>
                  <p className="text-[11px] text-[var(--ps-text-muted)] truncate max-w-[280px]">
                    {listingTitle.replace(/^\[SAMPLE\]\s*/i, '')} · {listingLocality}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsVisitModalOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Preferred Date *
                  </span>
                  <input
                    type="date"
                    required
                    min={new Date().toISOString().slice(0, 10)}
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <CustomSelectModal
                  label="Preferred Slot *"
                  value={preferredSlot}
                  onChange={(val) => setPreferredSlot(val as PropertyVisitSlot)}
                  options={[
                    { value: 'morning', label: 'Morning (9 AM – 12 PM)' },
                    { value: 'afternoon', label: 'Afternoon (12 PM – 4 PM)' },
                    { value: 'evening', label: 'Evening (4 PM – 7 PM)' },
                  ]}
                />

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Your Name *
                  </span>
                  <input
                    required
                    value={requesterName}
                    onChange={(e) => setRequesterName(e.target.value)}
                    placeholder="Full name"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Phone Number *
                  </span>
                  <input
                    required
                    type="tel"
                    value={requesterPhone}
                    onChange={(e) => setRequesterPhone(e.target.value)}
                    placeholder="+91 98620 XXXXX"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Message (optional)
                  </span>
                  <textarea
                    rows={2}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Family size, move-in timeline, or questions…"
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs text-[var(--ps-text)]"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsVisitModalOpen(false)}
                  className="h-9 rounded-xl border border-[var(--ps-border)] px-3.5 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60 cursor-pointer"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span>Confirm Visit Request</span>
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
      {confirmVisitDialog}
    </section>
  );
}
