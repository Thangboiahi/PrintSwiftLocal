'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CalendarDays,
  Home,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type {
  ListingRealEstateProfile,
  PropertyVisitRequest,
} from '@/lib/real-estate/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface HubRealEstateGovernancePanelProps {
  hubId: string;
  hubName?: string;
}

interface HydratedPropertyRow extends ListingRealEstateProfile {
  listingTitle: string;
  listingLocality: string;
}

interface HydratedVisitMonitorRow extends PropertyVisitRequest {
  listingTitle: string;
}

export function HubRealEstateGovernancePanel({
  hubId,
  hubName = 'Active Hub',
}: HubRealEstateGovernancePanelProps) {
  const { setStatus } = useAppStatus();

  const [properties, setProperties] = useState<HydratedPropertyRow[]>([]);
  const [visits, setVisits] = useState<HydratedVisitMonitorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [propSearch, setPropSearch] = useState('');
  const [propFilter, setPropFilter] = useState<
    'all' | 'needs_verification' | 'boosted' | 'stale'
  >('all');

  const [visitSearch, setVisitSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!hubId || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [propsRes, visitsRes] = await Promise.all([
        supabase
          .from('listing_real_estate_profiles')
          .select('*, listings(id, title, locality)')
          .eq('hub_id', hubId)
          .order('updated_at', { ascending: false })
          .limit(60),
        supabase
          .from('property_visit_requests')
          .select('*, listings(id, title)')
          .eq('hub_id', hubId)
          .order('created_at', { ascending: false })
          .limit(40),
      ]);

      if (Array.isArray(propsRes.data)) {
        setProperties(
          (propsRes.data as Array<Record<string, unknown>>).map((row) => {
            const l = Array.isArray(row.listings)
              ? (row.listings[0] as Record<string, unknown> | undefined)
              : (row.listings as Record<string, unknown> | undefined);
            return {
              ...(row as unknown as ListingRealEstateProfile),
              price_inr: Number(row.price_inr ?? 0),
              listingTitle: String(l?.title || 'Property').replace(
                /^\[SAMPLE\]\s*/i,
                ''
              ),
              listingLocality: String(l?.locality || ''),
            };
          })
        );
      } else {
        setProperties([]);
      }

      if (Array.isArray(visitsRes.data)) {
        setVisits(
          (visitsRes.data as Array<Record<string, unknown>>).map((row) => {
            const l = Array.isArray(row.listings)
              ? (row.listings[0] as Record<string, unknown> | undefined)
              : (row.listings as Record<string, unknown> | undefined);
            return {
              ...(row as unknown as PropertyVisitRequest),
              listingTitle: String(l?.title || 'Property').replace(
                /^\[SAMPLE\]\s*/i,
                ''
              ),
            };
          })
        );
      } else {
        setVisits([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleToggleVerification = async (
    row: HydratedPropertyRow,
    field: 'patta_verified' | 'site_verified'
  ) => {
    const key = `${row.listing_id}:${field}`;
    setBusyKey(key);
    const nextVal = !row[field];
    try {
      const { error } = await supabase
        .from('listing_real_estate_profiles')
        .update({ [field]: nextVal })
        .eq('listing_id', row.listing_id);
      if (error) throw error;
      setProperties((prev) =>
        prev.map((p) =>
          p.listing_id === row.listing_id ? { ...p, [field]: nextVal } : p
        )
      );
      setStatus(
        'success',
        `${row.listingTitle} ${
          field === 'patta_verified' ? 'Patta' : 'Site'
        } verification ${nextVal ? 'approved' : 'revoked'}.`
      );
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Verification update failed.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const filteredProps = useMemo(() => {
    const q = propSearch.trim().toLowerCase();
    return properties.filter((p) => {
      const boosted = Boolean(
        p.verified_boost_expires_at &&
          Date.parse(p.verified_boost_expires_at) > Date.now()
      );
      const stale = getFreshnessState(p.freshness_expires_at) === 'stale';

      if (
        propFilter === 'needs_verification' &&
        p.patta_verified &&
        p.site_verified
      ) {
        return false;
      }
      if (propFilter === 'boosted' && !boosted) return false;
      if (propFilter === 'stale' && !stale) return false;

      if (!q) return true;
      return (
        p.listingTitle.toLowerCase().includes(q) ||
        p.listingLocality.toLowerCase().includes(q) ||
        p.deal_type.toLowerCase().includes(q)
      );
    });
  }, [properties, propSearch, propFilter]);

  const filteredVisits = useMemo(() => {
    const q = visitSearch.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter(
      (v) =>
        v.request_code.toLowerCase().includes(q) ||
        v.listingTitle.toLowerCase().includes(q) ||
        v.requester_name.toLowerCase().includes(q)
    );
  }, [visits, visitSearch]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Real Estate Governance — {hubName}
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Verify local Patta/Village Authority documents &amp; site inspections, and monitor site visit activity in {hubName}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Table 1: Patta & Site Verification Queue */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-violet-600" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Patta &amp; Site Verification Queue ({properties.length})
          </h3>
        </div>

        <WorkspaceTableToolbar
          searchQuery={propSearch}
          onSearchChange={setPropSearch}
          searchPlaceholder="Search property title, locality or deal…"
          totalCount={properties.length}
          filteredCount={filteredProps.length}
          hasActiveFilters={Boolean(propSearch) || propFilter !== 'all'}
          onResetFilters={() => {
            setPropSearch('');
            setPropFilter('all');
          }}
        >
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'needs_verification', label: 'Needs Verification' },
                { id: 'boosted', label: 'Boosted' },
                { id: 'stale', label: 'Stale >30d' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPropFilter(f.id)}
                className={`h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                  propFilter === f.id
                    ? 'bg-violet-600 text-white'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll>
          <table className="w-full min-w-[740px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2 pr-3">Property</th>
                <th className="py-2 pr-3">Deal &amp; Price</th>
                <th className="py-2 pr-3">Freshness</th>
                <th className="py-2 pr-3">Patta Verification</th>
                <th className="py-2 text-right">Site Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/60">
              {filteredProps.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No properties match this filter.
                  </td>
                </tr>
              ) : (
                filteredProps.map((row) => {
                  const boosted = Boolean(
                    row.verified_boost_expires_at &&
                      Date.parse(row.verified_boost_expires_at) > Date.now()
                  );
                  const freshState = getFreshnessState(row.freshness_expires_at);
                  return (
                    <tr key={row.listing_id}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[var(--ps-text)]">
                            {row.listingTitle}
                          </span>
                          {boosted && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700 dark:text-amber-300">
                              <Sparkles className="h-2.5 w-2.5" />
                              BOOSTED
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[var(--ps-text-muted)]">
                          {row.listingLocality} · {row.patta_status.replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="font-mono font-bold text-violet-700 dark:text-violet-300">
                          {formatIndianPropertyPrice(
                            row.price_inr,
                            row.price_period
                          )}
                        </p>
                        <p className="text-[10px] uppercase text-[var(--ps-text-muted)]">
                          {row.deal_type} · {row.availability_status.replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            freshState === 'stale'
                              ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                              : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {freshState === 'stale' ? 'Stale >30d' : 'Fresh'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <button
                          type="button"
                          disabled={busyKey === `${row.listing_id}:patta_verified`}
                          onClick={() =>
                            void handleToggleVerification(row, 'patta_verified')
                          }
                          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold cursor-pointer ${
                            row.patta_verified
                              ? 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {busyKey === `${row.listing_id}:patta_verified` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <BadgeCheck className="h-3 w-3" />
                          )}
                          <span>
                            {row.patta_verified
                              ? 'Patta Verified ✓'
                              : 'Verify Patta'}
                          </span>
                        </button>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={busyKey === `${row.listing_id}:site_verified`}
                          onClick={() =>
                            void handleToggleVerification(row, 'site_verified')
                          }
                          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold cursor-pointer ${
                            row.site_verified
                              ? 'border border-violet-500/35 bg-violet-500/12 text-violet-700 dark:text-violet-300'
                              : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {busyKey === `${row.listing_id}:site_verified` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3 w-3" />
                          )}
                          <span>
                            {row.site_verified ? 'Site Verified ✓' : 'Verify Site'}
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

      {/* Table 2: Hub Site Visit Monitor (Read-Only) */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[var(--ps-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Hub Site Visit Monitor — Read-Only ({visits.length})
          </h3>
        </div>

        <WorkspaceTableToolbar
          searchQuery={visitSearch}
          onSearchChange={setVisitSearch}
          searchPlaceholder="Search visit code, property or visitor…"
          totalCount={visits.length}
          filteredCount={filteredVisits.length}
          hasActiveFilters={Boolean(visitSearch)}
          onResetFilters={() => setVisitSearch('')}
        />

        <ResponsiveTableScroll>
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Property</th>
                <th className="py-2 pr-3">Visitor</th>
                <th className="py-2 pr-3">Preferred Slot</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/60">
              {filteredVisits.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-6 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No site visit requests recorded in {hubName} yet.
                  </td>
                </tr>
              ) : (
                filteredVisits.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2.5 pr-3 font-mono font-bold text-violet-700 dark:text-violet-300">
                      {v.request_code}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-[var(--ps-text)]">
                      {v.listingTitle}
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--ps-text-muted)]">
                      {v.requester_name}
                    </td>
                    <td className="py-2.5 pr-3 capitalize">
                      {v.preferred_date} · {v.preferred_slot}
                    </td>
                    <td className="py-2.5 capitalize font-semibold">
                      {v.status}
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
