'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  Clock,
  HeartPulse,
  Landmark,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { CivicMapCard } from '@/components/verticals/civic/CivicMapCard';
import { CivicSummaryModal } from '@/components/verticals/civic/CivicSummaryModal';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { useAppStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { Listing } from '@/lib/types';
import type {
  CivicDepartmentType,
  ListingCivicProfile,
} from '@/lib/verticals/types';

type CivicFilterKey =
  | 'all'
  | 'emergency_medical'
  | 'police_fire'
  | 'government_office'
  | 'utility_power_water'
  | 'community';

interface CivicDirectoryEntry {
  listing: Listing;
  profile: ListingCivicProfile | null;
}

const CIVIC_FILTER_PILLS: Array<{
  key: CivicFilterKey;
  label: string;
  icon: typeof Landmark;
}> = [
  { key: 'all', label: 'All', icon: Landmark },
  {
    key: 'emergency_medical',
    label: 'Emergency & Hospitals',
    icon: HeartPulse,
  },
  { key: 'police_fire', label: 'Police & Fire', icon: ShieldAlert },
  { key: 'government_office', label: 'Govt Offices', icon: Landmark },
  { key: 'utility_power_water', label: 'Electricity & Water', icon: Zap },
  { key: 'community', label: 'Community', icon: Building2 },
];

function mapCivicRowToListing(
  row: Record<string, unknown>,
  profile: ListingCivicProfile
): Listing {
  const lat = Number(row.lat ?? 24.333);
  const lng = Number(row.lng ?? 93.679);
  const primaryHelpline = profile.helplines?.[0];
  return {
    id: String(row.id || ''),
    hub_id: typeof row.hub_id === 'string' ? row.hub_id : profile.hub_id,
    title: String(row.title || 'Public Service'),
    category: 'public_place',
    listing_vertical: 'public_civic',
    is_civic_record: true,
    subcategory: String(row.subcategory || profile.department_type || 'Civic'),
    status: 'published',
    locality: String(row.locality || 'Central'),
    address: String(row.address || row.locality || ''),
    coordinates: {
      lat: Number.isFinite(lat) ? lat : 24.333,
      lng: Number.isFinite(lng) ? lng : 93.679,
    },
    shortDescription: String(row.short_description || row.description || ''),
    description: String(row.description || row.short_description || ''),
    verificationStatus:
      row.verified || profile.last_verified_at
        ? 'verified_demo'
        : 'pending_review',
    contactPhone: String(
      row.contact_phone || row.phone || primaryHelpline?.phone || ''
    ),
    contactEmail: '',
    ownerId: String(row.owner_id || ''),
    ownerName: String(row.owner_name || 'Public Authority'),
    assignedStaffIds: [],
    coverImage: String(row.cover_image || ''),
    galleryImages: Array.isArray(row.gallery)
      ? (row.gallery as string[]).filter(Boolean)
      : [],
    rating: 0,
    reviewCount: 0,
    viewsCount: 0,
    mapImpressionsCount: 0,
    detailVisitsCount: 0,
    followsCount: 0,
    enquiriesCount: 0,
    directionClicksCount: 0,
    versionHistory: [],
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    vertical_summary: {
      department_type: profile.department_type,
      is_24x7: profile.is_24x7,
      office_hours_text: profile.office_hours_text,
      primary_helpline_label: primaryHelpline?.label ?? null,
      primary_helpline_phone: primaryHelpline?.phone ?? null,
      checklist_count: Array.isArray(profile.document_checklists)
        ? profile.document_checklists.length
        : 0,
      live_civic_alert: profile.live_civic_alert,
      last_verified_at: profile.last_verified_at,
    },
  };
}

export function CivicDirectoryPageClient() {
  const router = useRouter();
  const { activeHub } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';

  const { listings: storeListings } = useAppStore();
  const { isSaved, toggleSave } = useSavedInterests();

  const [entries, setEntries] = useState<CivicDirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [departmentFilter, setDepartmentFilter] =
    useState<CivicFilterKey>('all');
  const [only24x7, setOnly24x7] = useState<boolean>(false);
  const [selectedEntry, setSelectedEntry] =
    useState<CivicDirectoryEntry | null>(null);

  const loadCivicDirectory = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const localFallback = (): CivicDirectoryEntry[] =>
        storeListings
          .filter(
            (l) =>
              (l.listing_vertical === 'public_civic' ||
                l.is_civic_record ||
                l.category === 'public_place') &&
              (!activeHubId ||
                activeHubId.startsWith('fallback-') ||
                !l.hub_id ||
                l.hub_id === activeHubId)
          )
          .map((listing) => ({ listing, profile: null }));

      if (!isSupabaseConfigured()) {
        setEntries(localFallback());
        return;
      }

      let query = supabase
        .from('listing_civic_profiles')
        .select(
          '*, listings!inner(id, hub_id, title, subcategory, locality, address, lat, lng, short_description, description, contact_phone, phone, whatsapp_number, owner_id, owner_name, cover_image, gallery, tags, featured, verified, status, lifecycle_status, created_at, updated_at)'
        )
        .order('is_24x7', { ascending: false });

      if (activeHubId && !activeHubId.startsWith('fallback-')) {
        query = query.eq('listings.hub_id', activeHubId);
      }

      const { data, error } = await query;

      if (error) {
        const fallback = localFallback();
        setEntries(fallback);
        if (fallback.length === 0) {
          setErrorMessage(error.message || 'Could not load civic directory.');
        }
        return;
      }

      const mapped: CivicDirectoryEntry[] = [];
      for (const raw of (data || []) as Array<Record<string, unknown>>) {
        const listingJoin = Array.isArray(raw.listings)
          ? (raw.listings[0] as Record<string, unknown> | undefined)
          : (raw.listings as Record<string, unknown> | undefined);
        if (!listingJoin) continue;
        const lifecycle = String(listingJoin.lifecycle_status || 'active');
        if (lifecycle !== 'active') continue;

        const profile: ListingCivicProfile = {
          listing_id: String(raw.listing_id || listingJoin.id || ''),
          hub_id: String(raw.hub_id || listingJoin.hub_id || activeHubId || ''),
          department_type: String(
            raw.department_type || 'government_office'
          ) as CivicDepartmentType,
          is_24x7: Boolean(raw.is_24x7),
          office_hours_text:
            typeof raw.office_hours_text === 'string'
              ? raw.office_hours_text
              : null,
          helplines: Array.isArray(raw.helplines)
            ? (raw.helplines as ListingCivicProfile['helplines'])
            : [],
          document_checklists: Array.isArray(raw.document_checklists)
            ? (raw.document_checklists as ListingCivicProfile['document_checklists'])
            : [],
          important_notes:
            typeof raw.important_notes === 'string'
              ? raw.important_notes
              : null,
          live_civic_alert:
            typeof raw.live_civic_alert === 'string'
              ? raw.live_civic_alert
              : null,
          live_civic_alert_expires_at:
            typeof raw.live_civic_alert_expires_at === 'string'
              ? raw.live_civic_alert_expires_at
              : null,
          official_website:
            typeof raw.official_website === 'string'
              ? raw.official_website
              : null,
          show_nearby_print_helper: Boolean(raw.show_nearby_print_helper),
          last_verified_at:
            typeof raw.last_verified_at === 'string'
              ? raw.last_verified_at
              : null,
          last_verified_by:
            typeof raw.last_verified_by === 'string'
              ? raw.last_verified_by
              : null,
        };

        mapped.push({
          listing: mapCivicRowToListing(listingJoin, profile),
          profile,
        });
      }

      setEntries(mapped);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to load public directory.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeHubId, storeListings]);

  useEffect(() => {
    void loadCivicDirectory();
  }, [loadCivicDirectory]);

  // Pinned active live_civic_alert banners in this hub
  const activeAlerts = useMemo(
    () =>
      entries.filter((entry) => {
        const rawAlert =
          entry.profile?.live_civic_alert ??
          entry.listing.vertical_summary?.live_civic_alert;
        const alertText = typeof rawAlert === 'string' ? rawAlert : '';
        return alertText.trim().length > 0;
      }),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter(({ listing, profile }) => {
      const dept =
        profile?.department_type ||
        listing.vertical_summary?.department_type ||
        'government_office';
      const is24x7 = Boolean(
        profile?.is_24x7 ?? listing.vertical_summary?.is_24x7
      );

      if (departmentFilter !== 'all') {
        if (departmentFilter === 'community') {
          if (
            dept !== 'community_religious' &&
            dept !== 'public_transport_hub' &&
            dept !== 'education_public'
          ) {
            return false;
          }
        } else if (dept !== departmentFilter) {
          return false;
        }
      }

      if (only24x7 && !is24x7) {
        return false;
      }

      if (q) {
        const inTitle = listing.title.toLowerCase().includes(q);
        const inLocality = (listing.locality || '').toLowerCase().includes(q);
        const inDesc = (listing.shortDescription || '')
          .toLowerCase()
          .includes(q);
        const inHelplines = (profile?.helplines || []).some(
          (h) =>
            h.label.toLowerCase().includes(q) ||
            h.phone.toLowerCase().includes(q)
        );
        if (!inTitle && !inLocality && !inDesc && !inHelplines) {
          return false;
        }
      }

      return true;
    });
  }, [entries, departmentFilter, only24x7, searchQuery]);

  const handleCenterOnMap = (item: Listing) => {
    router.push(
      `/explore?hub=${encodeURIComponent(activeHubSlug)}&listing=${encodeURIComponent(item.id)}`
    );
  };

  return (
    <div
      data-testid="civic-directory-page"
      className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6 space-y-5 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Header & Search */}
      <section className="space-y-3 border-b border-[var(--ps-border)] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/12 text-rose-700 dark:text-rose-300 border border-rose-500/25">
              <Phone className="w-3 h-3" aria-hidden="true" />
              <span>Emergency &amp; Civic Quick-Dial</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)] flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
              <span>{activeHubName} Public Helplines &amp; Services</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
              Verified hospitals, police &amp; fire stations, government offices, electricity/water helplines, and document checklists.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search
                className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search hospital, police, DC office, helpline..."
                aria-label="Search civic directory"
                data-testid="civic-directory-search"
                className="w-full h-9 pl-9 pr-8 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear civic search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOnly24x7((prev) => !prev)}
              aria-pressed={only24x7}
              data-testid="civic-24x7-toggle"
              className={`h-9 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                only24x7
                  ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                  : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>24×7 Only</span>
            </button>
          </div>
        </div>

        {/* Department Filter Pills */}
        <div
          role="tablist"
          aria-label="Civic department filter"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5"
        >
          {CIVIC_FILTER_PILLS.map((pill) => {
            const Icon = pill.icon;
            const isActive = departmentFilter === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setDepartmentFilter(pill.key)}
                className={`h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{pill.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Pinned Live Civic Alert Banner Strip */}
      {activeAlerts.length > 0 && (
        <section
          aria-label="Live civic alerts"
          data-testid="civic-live-alert-strip"
          className="space-y-2"
        >
          {activeAlerts.map((entry) => {
            const rawAlert =
              entry.profile?.live_civic_alert ??
              entry.listing.vertical_summary?.live_civic_alert;
            const alertText = typeof rawAlert === 'string' ? rawAlert : '';
            return (
              <div
                key={entry.listing.id}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-start gap-2 min-w-0 flex-1 text-amber-950 dark:text-amber-200">
                  <AlertTriangle
                    className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span className="font-bold">{entry.listing.title}: </span>
                    <span>{alertText}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEntry(entry)}
                  className="h-7 px-2.5 rounded-lg bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 transition-colors shrink-0 cursor-pointer"
                >
                  View Helplines
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* Directory Grid */}
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-2 text-sm text-[var(--ps-text-muted)]">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ps-accent)]" />
          <span>Loading {activeHubName} public services...</span>
        </div>
      ) : errorMessage && filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-[var(--ps-text)]">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => void loadCivicDirectory()}
            className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-[var(--ps-text)]">
            No matching public services found in {activeHubName}.
          </p>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Try clearing your search or switching off the 24×7 filter.
          </p>
          {(searchQuery || departmentFilter !== 'all' || only24x7) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setDepartmentFilter('all');
                setOnly24x7(false);
              }}
              className="mt-2 h-8 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredEntries.map((entry) => (
            <CivicMapCard
              key={entry.listing.id}
              item={entry.listing}
              isSaved={isSaved('listing', entry.listing.id)}
              isHovered={false}
              isSelected={selectedEntry?.listing.id === entry.listing.id}
              isMobileLandscape={false}
              onMouseEnter={() => {}}
              onMouseLeave={() => {}}
              onOpenCivicSummary={() => setSelectedEntry(entry)}
              onCenterOnMap={() => handleCenterOnMap(entry.listing)}
              onToggleSave={() => void toggleSave('listing', entry.listing.id)}
            />
          ))}
        </div>
      )}

      {/* Footer Link to Full Map */}
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ps-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
          <span>Need directions on the live map?</span>
        </span>
        <Link
          href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&vertical=public_civic`}
          className="font-semibold text-[var(--ps-accent)] hover:underline whitespace-nowrap"
        >
          Open Civic Services on Map →
        </Link>
      </div>

      {/* Civic Summary Modal */}
      {selectedEntry && (
        <CivicSummaryModal
          listing={selectedEntry.listing}
          initialProfile={selectedEntry.profile}
          onClose={() => setSelectedEntry(null)}
          onCenterOnMap={(item) => {
            setSelectedEntry(null);
            handleCenterOnMap(item);
          }}
        />
      )}
    </div>
  );
}

export default CivicDirectoryPageClient;
