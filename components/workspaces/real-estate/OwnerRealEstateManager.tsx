'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Crown,
  Home,
  Loader2,
  Lock,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type {
  ListingRealEstateProfile,
  PattaStatus,
  PropertyVisitRequest,
  RealEstateAvailabilityStatus,
  RealEstateContactRevealPolicy,
  RealEstateDealType,
  RealEstateFurnishing,
  RealEstateListedByRole,
  RealEstatePricePeriod,
  RealEstatePropertyType,
  RoadAccessType,
  WaterSupplyType,
} from '@/lib/real-estate/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface RealEstateListingOption {
  id: string;
  title: string;
  locality?: string;
  hubId?: string | null;
  hub_id?: string | null;
  listing_vertical?: string | null;
}

export interface OwnerRealEstateManagerProps {
  listings: RealEstateListingOption[];
  activeListingId?: string;
  isStaffMode?: boolean;
}

interface AgentProPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  duration_days: number;
}

type RealEstateSubTab = 'visits' | 'specs';

export function OwnerRealEstateManager({
  listings,
  activeListingId,
  isStaffMode = false,
}: OwnerRealEstateManagerProps) {
  const { setStatus } = useAppStatus();

  const [enrichedListings, setEnrichedListings] = useState<
    Array<{
      id: string;
      title: string;
      locality: string;
      hub_id: string | null;
      listing_vertical: string;
    }>
  >([]);
  const [selectedListingId, setSelectedListingId] = useState<string>(
    activeListingId || ''
  );

  const [activeTab, setActiveTab] = useState<RealEstateSubTab>('visits');
  const [profile, setProfile] = useState<ListingRealEstateProfile | null>(null);
  const [visitRequests, setVisitRequests] = useState<PropertyVisitRequest[]>(
    []
  );
  const [agentProPlan, setAgentProPlan] = useState<AgentProPlanRow | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSavingSpecs, setIsSavingSpecs] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Visit queue filters
  const [visitSearch, setVisitSearch] = useState('');
  const [visitStatusFilter, setVisitStatusFilter] = useState('all');

  // Reschedule modal (z-[90])
  const [rescheduleTarget, setRescheduleTarget] =
    useState<PropertyVisitRequest | null>(null);
  const [rescheduleNote, setRescheduleNote] = useState('');

  // Paid Boost / Agent Pro Payment Modal (z-[90])
  const [activePaymentIntent, setActivePaymentIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [paymentModalMeta, setPaymentModalMeta] = useState({
    title: '30-Day Verified Property Boost',
    subtitle: '',
  });
  const [isCreatingBoost, setIsCreatingBoost] = useState(false);
  const [isCreatingAgentPro, setIsCreatingAgentPro] = useState(false);

  // Property Specs Form Draft
  const [specsDraft, setSpecsDraft] = useState({
    deal_type: 'rent' as RealEstateDealType,
    property_type: 'house' as RealEstatePropertyType,
    price_inr: '10000',
    price_period: 'monthly' as RealEstatePricePeriod,
    deposit_inr: '',
    is_negotiable: true,
    bedrooms: '2',
    bathrooms: '1',
    area_sqft: '',
    land_area_text: '',
    furnishing: 'unfurnished' as RealEstateFurnishing,
    patta_status: 'not_applicable' as PattaStatus,
    water_supply: 'municipal' as WaterSupplyType,
    road_access: 'car_accessible' as RoadAccessType,
    power_backup: false,
    parking_available: false,
    listed_by_role: 'owner' as RealEstateListedByRole,
    show_exact_pin: false,
    contact_reveal_policy: 'after_visit_accept' as RealEstateContactRevealPolicy,
    optional_tour_url: '',
  });

  // Fetch listing verticals
  useEffect(() => {
    let active = true;
    async function loadMeta() {
      if (!listings.length) {
        if (active) {
          setEnrichedListings([]);
          setSelectedListingId('');
          setIsLoading(false);
        }
        return;
      }

      const ids = listings.map((l) => l.id).filter(Boolean);
      const dbMetaMap = new Map<
        string,
        { listing_vertical: string; hub_id: string | null; locality: string }
      >();

      if (isSupabaseConfigured() && ids.length > 0) {
        const { data } = await supabase
          .from('listings')
          .select('id, listing_vertical, hub_id, locality')
          .in('id', ids);
        if (Array.isArray(data)) {
          for (const r of data as Array<Record<string, unknown>>) {
            dbMetaMap.set(String(r.id), {
              listing_vertical: String(r.listing_vertical || 'standard'),
              hub_id: r.hub_id ? String(r.hub_id) : null,
              locality: String(r.locality || ''),
            });
          }
        }
      }

      const mapped = listings.map((l) => {
        const meta = dbMetaMap.get(l.id);
        return {
          id: l.id,
          title: l.title,
          locality: meta?.locality || l.locality || '',
          hub_id: meta?.hub_id || l.hub_id || l.hubId || null,
          listing_vertical:
            meta?.listing_vertical || l.listing_vertical || 'standard',
        };
      });

      mapped.sort((a, b) => {
        const aRe = a.listing_vertical === 'real_estate' ? 0 : 1;
        const bRe = b.listing_vertical === 'real_estate' ? 0 : 1;
        return aRe - bRe;
      });

      if (!active) return;
      setEnrichedListings(mapped);
      setSelectedListingId((prev) => {
        if (prev && mapped.some((m) => m.id === prev)) return prev;
        if (activeListingId && mapped.some((m) => m.id === activeListingId)) {
          return activeListingId;
        }
        return mapped[0]?.id || '';
      });
    }
    void loadMeta();
    return () => {
      active = false;
    };
  }, [listings, activeListingId]);

  const selectedListing = useMemo(
    () => enrichedListings.find((l) => l.id === selectedListingId) || null,
    [enrichedListings, selectedListingId]
  );

  const loadRealEstateData = useCallback(async () => {
    if (!selectedListing || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [profRes, visitsRes, planRes] = await Promise.all([
        supabase
          .from('listing_real_estate_profiles')
          .select('*')
          .eq('listing_id', selectedListing.id)
          .maybeSingle(),
        supabase
          .from('property_visit_requests')
          .select('*')
          .eq('listing_id', selectedListing.id)
          .order('created_at', { ascending: false })
          .limit(60),
        !isStaffMode
          ? supabase
              .from('subscription_plans')
              .select('id, slug, name, price_inr, duration_days')
              .eq('plan_scope', 'agent_pro')
              .eq('is_active', true)
              .order('price_inr', { ascending: true })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const prof = profRes.data as ListingRealEstateProfile | null;
      setProfile(prof);
      if (prof) {
        setSpecsDraft({
          deal_type: prof.deal_type,
          property_type: prof.property_type,
          price_inr: String(prof.price_inr ?? 0),
          price_period: prof.price_period,
          deposit_inr:
            prof.deposit_inr !== null && prof.deposit_inr !== undefined
              ? String(prof.deposit_inr)
              : '',
          is_negotiable: Boolean(prof.is_negotiable),
          bedrooms:
            prof.bedrooms !== null && prof.bedrooms !== undefined
              ? String(prof.bedrooms)
              : '',
          bathrooms:
            prof.bathrooms !== null && prof.bathrooms !== undefined
              ? String(prof.bathrooms)
              : '',
          area_sqft:
            prof.area_sqft !== null && prof.area_sqft !== undefined
              ? String(prof.area_sqft)
              : '',
          land_area_text: prof.land_area_text || '',
          furnishing: prof.furnishing,
          patta_status: prof.patta_status,
          water_supply: prof.water_supply,
          road_access: prof.road_access,
          power_backup: Boolean(prof.power_backup),
          parking_available: Boolean(prof.parking_available),
          listed_by_role: prof.listed_by_role,
          show_exact_pin: Boolean(prof.show_exact_pin),
          contact_reveal_policy: prof.contact_reveal_policy,
          optional_tour_url: prof.optional_tour_url || '',
        });
      }

      setVisitRequests(
        Array.isArray(visitsRes.data)
          ? (visitsRes.data as PropertyVisitRequest[])
          : []
      );

      setAgentProPlan(
        planRes.data
          ? {
              ...(planRes.data as AgentProPlanRow),
              price_inr: Number((planRes.data as AgentProPlanRow).price_inr || 799),
              duration_days: Number(
                (planRes.data as AgentProPlanRow).duration_days || 30
              ),
            }
          : null
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedListing, isStaffMode]);

  useEffect(() => {
    void loadRealEstateData();
  }, [loadRealEstateData]);

  // Initialize Real Estate Profile on general listing
  const handleInitializeRealEstate = async () => {
    if (!selectedListing || isStaffMode) return;
    setIsInitializing(true);
    setStatus('saving', 'Initializing Real Estate profile…');
    try {
      const { error: upErr } = await supabase
        .from('listings')
        .update({ listing_vertical: 'real_estate' })
        .eq('id', selectedListing.id);
      if (upErr) throw upErr;

      const { error: profErr } = await supabase
        .from('listing_real_estate_profiles')
        .upsert(
          {
            listing_id: selectedListing.id,
            hub_id: selectedListing.hub_id,
            deal_type: 'rent',
            property_type: 'house',
            price_inr: 10000,
            price_period: 'monthly',
          },
          { onConflict: 'listing_id' }
        );
      if (profErr) throw profErr;

      setEnrichedListings((prev) =>
        prev.map((l) =>
          l.id === selectedListing.id
            ? { ...l, listing_vertical: 'real_estate' }
            : l
        )
      );
      setStatus('success', 'Real Estate property profile initialized!');
      await loadRealEstateData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Could not initialize Real Estate profile.'
      );
    } finally {
      setIsInitializing(false);
    }
  };

  // 30-Day Freshness / Availability Status Update
  const handleFreshnessUpdate = async (
    availabilityStatus: RealEstateAvailabilityStatus
  ) => {
    if (!selectedListing || isStaffMode) return;
    setBusyId('freshness');
    setStatus('saving', 'Updating property availability…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/real-estate/freshness', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          listingId: selectedListing.id,
          availabilityStatus,
        }),
      });
      const json = (await res.json()) as {
        profile?: ListingRealEstateProfile;
        error?: string;
      };
      if (!res.ok) {
        setStatus('error', json.error || 'Could not confirm property freshness.');
        return;
      }
      if (json.profile) {
        setProfile(json.profile);
      } else {
        await loadRealEstateData();
      }
      setStatus(
        'success',
        availabilityStatus === 'available'
          ? 'Confirmed Still Available (+30 Days)!'
          : `Status updated to ${availabilityStatus.replace(/_/g, ' ')}.`
      );
    } finally {
      setBusyId(null);
    }
  };

  // 1-Click 30-Day Verified Property Boost Checkout
  const handleStartBoostCheckout = async () => {
    if (!selectedListing || isStaffMode) return;
    setIsCreatingBoost(true);
    setStatus('saving', 'Preparing 30-Day Verified Boost checkout…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/real-estate/boost/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          listingId: selectedListing.id,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        setStatus('error', json.error || 'Could not initialize boost checkout.');
        return;
      }
      setPaymentModalMeta({
        title: '30-Day Verified Property Boost',
        subtitle: `${selectedListing.title} · Featured Map Pin + Priority Ranking`,
      });
      setActivePaymentIntent(json.intent);
    } finally {
      setIsCreatingBoost(false);
    }
  };

  // Agent Pro Subscription Checkout
  const handleStartAgentProCheckout = async () => {
    if (!selectedListing || !agentProPlan || isStaffMode) return;
    setIsCreatingAgentPro(true);
    setStatus('saving', 'Preparing Agent Pro checkout…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          purpose: 'agent_pro_subscription',
          planId: agentProPlan.id,
          listingId: selectedListing.id,
          hubId: selectedListing.hub_id || undefined,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        setStatus('error', json.error || 'Could not start Agent Pro checkout.');
        return;
      }
      setPaymentModalMeta({
        title: agentProPlan.name,
        subtitle: `Up to 15 Active Properties · ${agentProPlan.duration_days} days`,
      });
      setActivePaymentIntent(json.intent);
    } finally {
      setIsCreatingAgentPro(false);
    }
  };

  // Site Visit Request Action (works in Staff Mode too)
  const handleVisitAction = async (
    requestId: string,
    status: 'accepted' | 'rescheduled' | 'completed' | 'declined',
    ownerNote?: string
  ) => {
    setBusyId(requestId);
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
          action: 'update_status',
          requestId,
          status,
          ownerNote: ownerNote?.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus('error', json.error || 'Could not update site visit.');
        return;
      }
      setStatus(
        'success',
        status === 'accepted'
          ? 'Site visit accepted & owner contact unlocked!'
          : `Site visit marked ${status}.`
      );
      setRescheduleTarget(null);
      setRescheduleNote('');
      await loadRealEstateData();
    } finally {
      setBusyId(null);
    }
  };

  // Save Property Specs & Privacy (Owner Only)
  const handleSaveSpecs = async () => {
    if (!selectedListing || !profile || isStaffMode) return;
    setIsSavingSpecs(true);
    try {
      const { error } = await supabase
        .from('listing_real_estate_profiles')
        .update({
          deal_type: specsDraft.deal_type,
          property_type: specsDraft.property_type,
          price_inr: Math.max(0, Number(specsDraft.price_inr) || 0),
          price_period: specsDraft.price_period,
          deposit_inr: specsDraft.deposit_inr.trim()
            ? Math.max(0, Number(specsDraft.deposit_inr) || 0)
            : null,
          is_negotiable: specsDraft.is_negotiable,
          bedrooms: specsDraft.bedrooms.trim()
            ? Math.max(0, Number(specsDraft.bedrooms) || 0)
            : null,
          bathrooms: specsDraft.bathrooms.trim()
            ? Math.max(0, Number(specsDraft.bathrooms) || 0)
            : null,
          area_sqft: specsDraft.area_sqft.trim()
            ? Math.max(0, Number(specsDraft.area_sqft) || 0)
            : null,
          land_area_text: specsDraft.land_area_text.trim() || null,
          furnishing: specsDraft.furnishing,
          patta_status: specsDraft.patta_status,
          water_supply: specsDraft.water_supply,
          road_access: specsDraft.road_access,
          power_backup: specsDraft.power_backup,
          parking_available: specsDraft.parking_available,
          listed_by_role: specsDraft.listed_by_role,
          show_exact_pin: specsDraft.show_exact_pin,
          contact_reveal_policy: specsDraft.contact_reveal_policy,
          optional_tour_url: specsDraft.optional_tour_url.trim() || null,
        })
        .eq('listing_id', selectedListing.id);
      if (error) throw error;
      setStatus('success', 'Property specs & privacy settings saved.');
      await loadRealEstateData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Could not save property specs.'
      );
    } finally {
      setIsSavingSpecs(false);
    }
  };

  const filteredVisits = useMemo(() => {
    const q = visitSearch.trim().toLowerCase();
    return visitRequests.filter((v) => {
      if (visitStatusFilter !== 'all' && v.status !== visitStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        v.request_code.toLowerCase().includes(q) ||
        v.requester_name.toLowerCase().includes(q) ||
        v.requester_phone.toLowerCase().includes(q)
      );
    });
  }, [visitRequests, visitSearch, visitStatusFilter]);

  const isBoosted = Boolean(
    profile?.verified_boost_expires_at &&
      !Number.isNaN(Date.parse(profile.verified_boost_expires_at)) &&
      Date.parse(profile.verified_boost_expires_at) > Date.now()
  );
  const freshnessState = getFreshnessState(profile?.freshness_expires_at);

  const listingOptions = useMemo(
    () =>
      enrichedListings.map((l) => ({
        value: l.id,
        label: l.title,
        description:
          l.listing_vertical === 'real_estate'
            ? `Real Estate · ${l.locality}`
            : `General Listing · ${l.locality}`,
      })),
    [enrichedListings]
  );

  if (enrichedListings.length === 0 && !isLoading) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
        <Home className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
        <p className="text-sm font-bold text-[var(--ps-text)]">
          No property listings available yet
        </p>
        <p className="text-xs text-[var(--ps-text-muted)]">
          Create or claim a listing first to manage Real Estate specs, 30-day freshness, and site visits.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Listing Switcher + Refresh */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div className="min-w-[220px] flex-1 max-w-md">
          <CustomSelectModal
            label={isStaffMode ? 'Assigned Property' : 'Select Property Listing'}
            value={selectedListingId}
            onChange={(val) => {
              setSelectedListingId(val);
              setVisitSearch('');
              setVisitStatusFilter('all');
            }}
            options={listingOptions}
            placeholder="Choose property"
          />
        </div>

        <button
          type="button"
          onClick={() => void loadRealEstateData()}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Initialize Real Estate Profile Prompt */}
      {selectedListing && !profile && !isLoading && (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center space-y-3">
          <Home className="mx-auto h-7 w-7 text-violet-600" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Initialize Real Estate Pro Profile for &ldquo;{selectedListing.title}&rdquo;
          </h3>
          <p className="mx-auto max-w-md text-xs text-[var(--ps-text-muted)]">
            Add Patta / Village Authority status, 24x7 water &amp; road access badges, privacy map pins, 30-day freshness renewal, and controlled site visit scheduling.
          </p>
          {!isStaffMode ? (
            <button
              type="button"
              disabled={isInitializing}
              onClick={() => void handleInitializeRealEstate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60 cursor-pointer"
            >
              {isInitializing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Home className="h-4 w-4" />
              )}
              <span>Enable Real Estate Pro</span>
            </button>
          ) : (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Ask the property owner to initialize Real Estate mode first.
            </p>
          )}
        </div>
      )}

      {/* 30-Day Freshness & Paid Boost Top Strip (OWNER ONLY) */}
      {!isStaffMode && selectedListing && profile && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Freshness & Availability Card */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock
                  className={`h-4 w-4 ${
                    freshnessState === 'stale'
                      ? 'text-rose-500'
                      : freshnessState === 'expiring_soon'
                        ? 'text-amber-500'
                        : 'text-emerald-600'
                  }`}
                />
                <span className="text-xs font-bold text-[var(--ps-text)]">
                  30-Day Freshness &amp; Status
                </span>
              </div>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                  freshnessState === 'stale'
                    ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                    : freshnessState === 'expiring_soon'
                      ? 'bg-amber-500/12 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {freshnessState === 'stale'
                  ? 'Stale (>30d)'
                  : freshnessState === 'expiring_soon'
                    ? 'Expiring Soon'
                    : 'Fresh'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === 'freshness'}
                onClick={() => void handleFreshnessUpdate('available')}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Confirm Still Available (+30 Days)</span>
              </button>

              <div className="min-w-[150px]">
                <CustomSelectModal
                  value={profile.availability_status}
                  onChange={(val) =>
                    void handleFreshnessUpdate(
                      val as RealEstateAvailabilityStatus
                    )
                  }
                  options={[
                    { value: 'available', label: 'Available' },
                    { value: 'under_offer', label: 'Under Offer' },
                    { value: 'sold_rented', label: 'Sold / Rented' },
                    { value: 'paused', label: 'Paused' },
                  ]}
                  placeholder="Status"
                />
              </div>
            </div>
          </div>

          {/* Paid Boost & Agent Pro Card */}
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/6 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-xs font-bold text-[var(--ps-text)]">
                  Verified Map Pin Boost &amp; Agent Pro
                </span>
              </div>
              {isBoosted && profile.verified_boost_expires_at && (
                <span className="rounded-md bg-gradient-to-r from-amber-500 to-violet-600 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">
                  BOOSTED UNTIL{' '}
                  {new Date(profile.verified_boost_expires_at).toLocaleDateString(
                    'en-IN',
                    { day: '2-digit', month: 'short' }
                  )}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isCreatingBoost}
                onClick={() => void handleStartBoostCheckout()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-violet-600 px-3 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60 cursor-pointer"
              >
                {isCreatingBoost ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>
                  {isBoosted
                    ? 'Extend +30 Days'
                    : 'Boost Property (30-Day Featured Map Pin)'}
                </span>
              </button>

              {agentProPlan && (
                <button
                  type="button"
                  disabled={isCreatingAgentPro}
                  onClick={() => void handleStartAgentProCheckout()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/12 px-3 text-xs font-bold text-amber-900 dark:text-amber-200 hover:bg-amber-500/20 disabled:opacity-60 cursor-pointer"
                >
                  {isCreatingAgentPro ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Crown className="h-3.5 w-3.5" />
                  )}
                  <span>
                    Agent Pro (15 Properties · ₹{agentProPlan.price_inr})
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tabs */}
      {selectedListing && profile && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('visits')}
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold cursor-pointer ${
                activeTab === 'visits'
                  ? 'bg-violet-600 text-white'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Site Visits ({visitRequests.length})</span>
            </button>

            {!isStaffMode && (
              <button
                type="button"
                onClick={() => setActiveTab('specs')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold cursor-pointer ${
                  activeTab === 'specs'
                    ? 'bg-violet-600 text-white'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                }`}
              >
                <Home className="h-3.5 w-3.5" />
                <span>Property Specs &amp; Privacy</span>
              </button>
            )}
          </div>

          {/* SUB-TAB 1: SITE VISIT REQUESTS QUEUE */}
          {activeTab === 'visits' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <WorkspaceTableToolbar
                searchQuery={visitSearch}
                onSearchChange={setVisitSearch}
                searchPlaceholder="Search visit code, name or phone…"
                totalCount={visitRequests.length}
                filteredCount={filteredVisits.length}
                hasActiveFilters={
                  Boolean(visitSearch) || visitStatusFilter !== 'all'
                }
                onResetFilters={() => {
                  setVisitSearch('');
                  setVisitStatusFilter('all');
                }}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      'all',
                      'requested',
                      'accepted',
                      'rescheduled',
                      'completed',
                      'declined',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setVisitStatusFilter(st)}
                      className={`h-8 rounded-xl px-2.5 text-xs font-semibold capitalize cursor-pointer ${
                        visitStatusFilter === st
                          ? 'bg-violet-600 text-white'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>

              <ResponsiveTableScroll>
                <table className="w-full min-w-[740px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Visitor</th>
                      <th className="py-2 pr-3">Preferred Visit</th>
                      <th className="py-2 pr-3">Status &amp; Contact</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredVisits.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                        >
                          No site visit requests match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredVisits.map((v) => (
                        <tr key={v.id} className="align-top">
                          <td className="py-3 pr-3 font-mono font-bold text-violet-700 dark:text-violet-300">
                            {v.request_code}
                          </td>
                          <td className="py-3 pr-3">
                            <p className="font-bold text-[var(--ps-text)]">
                              {v.requester_name}
                            </p>
                            <a
                              href={`tel:${v.requester_phone}`}
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              {v.requester_phone}
                            </a>
                            {v.message && (
                              <p className="mt-1 max-w-xs text-[11px] text-[var(--ps-text-muted)]">
                                &ldquo;{v.message}&rdquo;
                              </p>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <p className="font-semibold text-[var(--ps-text)]">
                              {v.preferred_date}
                            </p>
                            <p className="capitalize text-[11px] text-[var(--ps-text-muted)]">
                              {v.preferred_slot}
                            </p>
                          </td>
                          <td className="py-3 pr-3 space-y-1">
                            <span className="inline-block rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize">
                              {v.status}
                            </span>
                            {v.contact_revealed && (
                              <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                Contact Revealed ✓
                              </span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              {v.status === 'requested' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyId === v.id}
                                    onClick={() =>
                                      void handleVisitAction(v.id, 'accepted')
                                    }
                                    className="h-7 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white hover:bg-emerald-700 cursor-pointer"
                                  >
                                    Accept &amp; Reveal Contact
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === v.id}
                                    onClick={() => {
                                      setRescheduleTarget(v);
                                      setRescheduleNote(v.owner_note || '');
                                    }}
                                    className="h-7 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 cursor-pointer"
                                  >
                                    Reschedule
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === v.id}
                                    onClick={() =>
                                      void handleVisitAction(v.id, 'declined')
                                    }
                                    className="h-7 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                                  >
                                    Decline
                                  </button>
                                </>
                              )}
                              {(v.status === 'accepted' ||
                                v.status === 'rescheduled') && (
                                <button
                                  type="button"
                                  disabled={busyId === v.id}
                                  onClick={() =>
                                    void handleVisitAction(v.id, 'completed')
                                  }
                                  className="h-7 rounded-lg bg-violet-600 px-2.5 text-[11px] font-bold text-white hover:bg-violet-700 cursor-pointer"
                                >
                                  Mark Visited
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ResponsiveTableScroll>
            </div>
          )}

          {/* SUB-TAB 2: PROPERTY SPECS & PRIVACY (OWNER ONLY) */}
          {activeTab === 'specs' && !isStaffMode && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Property Specs, Regional Trust &amp; Privacy
                  </h3>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Live preview:{' '}
                    <strong className="font-mono text-violet-700 dark:text-violet-300">
                      {formatIndianPropertyPrice(
                        Number(specsDraft.price_inr) || 0,
                        specsDraft.price_period
                      )}
                    </strong>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-bold ${
                      profile.patta_verified
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    <BadgeCheck className="h-3.5 w-3.5" />
                    {profile.patta_verified
                      ? 'Patta Verified ✓'
                      : 'Pending Hub Verification'}
                  </span>
                  {profile.site_verified && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-violet-500/12 px-2 py-0.5 font-bold text-violet-700 dark:text-violet-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Site Verified ✓
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                <CustomSelectModal
                  label="Deal Type"
                  value={specsDraft.deal_type}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      deal_type: v as RealEstateDealType,
                    }))
                  }
                  options={[
                    { value: 'rent', label: 'For Rent' },
                    { value: 'sale', label: 'For Sale' },
                    { value: 'lease', label: 'For Lease' },
                    { value: 'pg_hostel', label: 'PG / Hostel' },
                  ]}
                />
                <CustomSelectModal
                  label="Property Type"
                  value={specsDraft.property_type}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      property_type: v as RealEstatePropertyType,
                    }))
                  }
                  options={[
                    { value: 'house', label: 'Independent House' },
                    { value: 'apartment', label: 'Apartment / Flat' },
                    { value: 'plot_land', label: 'Plot / Land' },
                    { value: 'commercial_shop', label: 'Commercial Shop' },
                    { value: 'room_pg', label: 'Room / PG' },
                  ]}
                />
                <CustomSelectModal
                  label="Price Period"
                  value={specsDraft.price_period}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      price_period: v as RealEstatePricePeriod,
                    }))
                  }
                  options={[
                    { value: 'monthly', label: 'Per Month (/mo)' },
                    { value: 'total', label: 'Total Sale Price' },
                    { value: 'yearly', label: 'Per Year (/yr)' },
                  ]}
                />
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Price (₹)
                  </span>
                  <input
                    type="number"
                    value={specsDraft.price_inr}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({ ...p, price_inr: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Deposit (₹, optional)
                  </span>
                  <input
                    type="number"
                    value={specsDraft.deposit_inr}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({
                        ...p,
                        deposit_inr: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Land / Area Text (e.g. 40 × 60 ft)
                  </span>
                  <input
                    value={specsDraft.land_area_text}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({
                        ...p,
                        land_area_text: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Bedrooms
                  </span>
                  <input
                    type="number"
                    value={specsDraft.bedrooms}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({ ...p, bedrooms: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Bathrooms
                  </span>
                  <input
                    type="number"
                    value={specsDraft.bathrooms}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({ ...p, bathrooms: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Area (sq.ft)
                  </span>
                  <input
                    type="number"
                    value={specsDraft.area_sqft}
                    onChange={(e) =>
                      setSpecsDraft((p) => ({ ...p, area_sqft: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
                <CustomSelectModal
                  label="Furnishing"
                  value={specsDraft.furnishing}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      furnishing: v as RealEstateFurnishing,
                    }))
                  }
                  options={[
                    { value: 'unfurnished', label: 'Unfurnished' },
                    { value: 'semi_furnished', label: 'Semi-Furnished' },
                    { value: 'furnished', label: 'Furnished' },
                    { value: 'not_applicable', label: 'Not Applicable' },
                  ]}
                />
                <CustomSelectModal
                  label="Patta / Land Record"
                  value={specsDraft.patta_status}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      patta_status: v as PattaStatus,
                    }))
                  }
                  options={[
                    { value: 'verified_patta', label: 'Clear Patta' },
                    {
                      value: 'village_authority',
                      label: 'Village Authority Certificate',
                    },
                    { value: 'leasehold', label: 'Leasehold' },
                    { value: 'not_applicable', label: 'Not Applicable' },
                  ]}
                />
                <CustomSelectModal
                  label="Water Supply"
                  value={specsDraft.water_supply}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      water_supply: v as WaterSupplyType,
                    }))
                  }
                  options={[
                    { value: '24x7', label: '24×7 Water' },
                    { value: 'municipal', label: 'Municipal Line' },
                    { value: 'borewell', label: 'Borewell' },
                    { value: 'tanker', label: 'Tanker Supply' },
                    { value: 'seasonal', label: 'Seasonal' },
                  ]}
                />
                <CustomSelectModal
                  label="Road Access"
                  value={specsDraft.road_access}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      road_access: v as RoadAccessType,
                    }))
                  }
                  options={[
                    { value: 'car_accessible', label: 'Car Accessible Road' },
                    { value: 'two_wheeler_only', label: 'Two-Wheeler Lane' },
                    { value: 'footpath', label: 'Footpath Access' },
                  ]}
                />
                <CustomSelectModal
                  label="Listed By"
                  value={specsDraft.listed_by_role}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      listed_by_role: v as RealEstateListedByRole,
                    }))
                  }
                  options={[
                    { value: 'owner', label: 'Direct Owner' },
                    { value: 'agent', label: 'Agent / Broker' },
                    { value: 'builder', label: 'Builder' },
                  ]}
                />
                <CustomSelectModal
                  label="Contact Reveal Policy"
                  value={specsDraft.contact_reveal_policy}
                  onChange={(v) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      contact_reveal_policy: v as RealEstateContactRevealPolicy,
                    }))
                  }
                  options={[
                    {
                      value: 'after_visit_accept',
                      label: 'Unlock After Visit Accept (Private)',
                    },
                    { value: 'direct_call', label: 'Direct Call Immediately' },
                  ]}
                />
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-[var(--ps-text-muted)]">
                  Optional Virtual Tour / Video URL (never required)
                </span>
                <input
                  type="url"
                  value={specsDraft.optional_tour_url}
                  onChange={(e) =>
                    setSpecsDraft((p) => ({
                      ...p,
                      optional_tour_url: e.target.value,
                    }))
                  }
                  placeholder="https://…"
                  className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                />
              </label>

              <div className="flex flex-wrap gap-4 text-xs">
                {(
                  [
                    ['is_negotiable', 'Price Negotiable'],
                    ['power_backup', 'Power Backup'],
                    ['parking_available', 'Parking Available'],
                    [
                      'show_exact_pin',
                      'Show Exact Map Pin (off = ~180m neighborhood privacy)',
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="inline-flex items-center gap-2 font-semibold text-[var(--ps-text)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={specsDraft[key]}
                      onChange={(e) =>
                        setSpecsDraft((p) => ({
                          ...p,
                          [key]: e.target.checked,
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-[var(--ps-border)] pt-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                  <Lock className="h-3.5 w-3.5" />
                  <span>
                    Patta &amp; Site verification badges are managed by your local Hub Manager.
                  </span>
                </span>
                <button
                  type="button"
                  disabled={isSavingSpecs}
                  onClick={() => void handleSaveSpecs()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60 cursor-pointer"
                >
                  {isSavingSpecs ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Property Specs</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reschedule Visit Modal (z-[90]) */}
      {rescheduleTarget &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => setRescheduleTarget(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Reschedule Visit ({rescheduleTarget.request_code})
                </h3>
                <button
                  type="button"
                  onClick={() => setRescheduleTarget(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                rows={3}
                value={rescheduleNote}
                onChange={(e) => setRescheduleNote(e.target.value)}
                placeholder="Suggest a new date/time (e.g. Tomorrow 4 PM works best)…"
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRescheduleTarget(null)}
                  className="h-8 rounded-xl border border-[var(--ps-border)] px-3 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId === rescheduleTarget.id}
                  onClick={() =>
                    void handleVisitAction(
                      rescheduleTarget.id,
                      'rescheduled',
                      rescheduleNote
                    )
                  }
                  className="h-8 rounded-xl bg-amber-600 px-3.5 text-xs font-bold text-white hover:bg-amber-700 cursor-pointer"
                >
                  Send Reschedule Note
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* UniversalPaymentModal (z-[90]) for 30-Day Boost & Agent Pro */}
      {activePaymentIntent && (
        <UniversalPaymentModal
          open={Boolean(activePaymentIntent)}
          onClose={() => setActivePaymentIntent(null)}
          intent={activePaymentIntent}
          title={paymentModalMeta.title}
          subtitle={paymentModalMeta.subtitle}
          onSubmitted={() => {
            setActivePaymentIntent(null);
            setStatus('success', 'Payment submitted! Boost activates on verification.');
            void loadRealEstateData();
          }}
        />
      )}
    </div>
  );
}
