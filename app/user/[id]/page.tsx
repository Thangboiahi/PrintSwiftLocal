'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
  User,
} from 'lucide-react';
import { Breadcrumbs, triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import { CATEGORY_LABELS, getListingPriceLabel } from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { fetchListings } from '@/lib/supabase/listings';
import { Listing } from '@/lib/types';

interface PublicOwnerProfileData {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  roleLabel: string;
  bio: string;
  avatarUrl: string | null;
  avatarInitials: string;
  socialLinks: Record<string, string>;
}

export default function PublicUserProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const rawId = typeof params?.id === 'string' ? decodeURIComponent(params.id) : 'owner-1';

  const { users, listings } = useAppStore();
  const [remoteProfile, setRemoteProfile] = useState<Partial<PublicOwnerProfileData> | null>(null);
  const [remoteListings, setRemoteListings] = useState<Listing[]>([]);
  const [isLoadingRemote, setIsLoadingRemote] = useState(true);

  useEffect(() => {
    let active = true;

    const loadPublicProfile = async () => {
      if (!isSupabaseConfigured()) {
        if (active) setIsLoadingRemote(false);
        return;
      }

      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, role, avatar_url, social_links')
          .eq('id', rawId)
          .maybeSingle();

        if (active && profileRow) {
          const parsedSocials: Record<string, string> = {};
          if (
            profileRow.social_links &&
            typeof profileRow.social_links === 'object' &&
            !Array.isArray(profileRow.social_links)
          ) {
            for (const [k, v] of Object.entries(
              profileRow.social_links as Record<string, unknown>
            )) {
              if (typeof v === 'string' && v.trim()) {
                parsedSocials[k] = v.trim();
              }
            }
          }

          setRemoteProfile({
            id: profileRow.id,
            fullName: profileRow.full_name || 'Verified Lamka Listing Owner',
            email: profileRow.email || '',
            phone: profileRow.phone || '',
            roleLabel: profileRow.role || 'owner',
            avatarUrl: profileRow.avatar_url?.trim() || null,
            socialLinks: parsedSocials,
          });
        }

        const ownerListings = await fetchListings(rawId);
        if (active && ownerListings.length > 0) {
          setRemoteListings(ownerListings);
        }
      } catch {
        // Fallback cleanly to local synthetic directory data
      } finally {
        if (active) setIsLoadingRemote(false);
      }
    };

    void loadPublicProfile();

    return () => {
      active = false;
    };
  }, [rawId]);

  const ownerListings = useMemo(() => {
    const localMatches = listings.filter(
      (l) => l.ownerId === rawId && l.status === 'published'
    );
    const seen = new Set<string>();
    const combined: Listing[] = [];

    for (const item of [...remoteListings, ...localMatches]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }
    return combined;
  }, [listings, remoteListings, rawId]);

  const resolvedProfile: PublicOwnerProfileData = useMemo(() => {
    const demoUser = users.find((u) => u.id === rawId);
    const sampleListing =
      ownerListings[0] || listings.find((l) => l.ownerId === rawId);

    const fullName =
      remoteProfile?.fullName ||
      demoUser?.name ||
      sampleListing?.ownerName ||
      'Lamka Verified Owner';

    const initials =
      demoUser?.avatarLabel ||
      fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    return {
      id: rawId,
      fullName,
      email:
        remoteProfile?.email ||
        demoUser?.email ||
        sampleListing?.contactEmail ||
        'owner@printswift-lamka.local',
      phone:
        remoteProfile?.phone ||
        sampleListing?.contactPhone ||
        '+91 98620 11223',
      roleLabel:
        remoteProfile?.roleLabel ||
        demoUser?.adminRole ||
        demoUser?.roleType ||
        'owner',
      bio:
        demoUser?.description ||
        `Verified Churachandpur directory contributor managing ${ownerListings.length} active local listing(s) in Lamka.`,
      avatarUrl: remoteProfile?.avatarUrl?.trim() || null,
      avatarInitials: initials,
      socialLinks: remoteProfile?.socialLinks || {
        WhatsApp: sampleListing?.contactPhone || '+91 98620 11223',
      },
    };
  }, [rawId, remoteProfile, users, ownerListings, listings]);

  const handleReturnToMap = () => {
    triggerUnmountOverlaysToMap();
    router.push('/');
  };

  return (
    <div
      data-testid="public-user-profile-page"
      className="min-h-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Bar with Breadcrumbs and Return to Map Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Breadcrumbs
            items={[
              { label: 'Public Profiles' },
              { label: resolvedProfile.fullName },
            ]}
          />

          <button
            type="button"
            onClick={handleReturnToMap}
            data-testid="public-profile-back-to-map-btn"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Return to Map</span>
          </button>
        </div>

        {/* Read-Only Public Profile Header Card */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {resolvedProfile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolvedProfile.avatarUrl}
                  alt={resolvedProfile.fullName}
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded-2xl object-cover border border-[var(--ps-border)] shrink-0"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--ps-accent)] text-lg font-extrabold text-[var(--ps-accent-fg)] shrink-0 shadow-xs">
                  {resolvedProfile.avatarInitials || <User className="h-7 w-7" />}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--ps-text)]">
                    {resolvedProfile.fullName}
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>{resolvedProfile.roleLabel}</span>
                  </span>
                </div>
                <p className="text-xs text-[var(--ps-text-muted)] max-w-2xl leading-relaxed">
                  {resolvedProfile.bio}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-3 text-xs space-y-1.5 shrink-0">
              <div className="font-bold text-[var(--ps-text)]">
                Public Contact
              </div>
              {resolvedProfile.phone && (
                <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
                  <Phone className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span className="font-mono">{resolvedProfile.phone}</span>
                </div>
              )}
              {resolvedProfile.email && (
                <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
                  <Mail className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span className="truncate max-w-[200px]">
                    {resolvedProfile.email}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Public Social Links */}
          {Object.keys(resolvedProfile.socialLinks).length > 0 && (
            <div className="pt-4 border-t border-[var(--ps-border)] flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                Connected Channels:
              </span>
              {Object.entries(resolvedProfile.socialLinks).map(
                ([platform, value]) => {
                  const isUrl =
                    value.startsWith('http://') || value.startsWith('https://');
                  return isUrl ? (
                    <a
                      key={platform}
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition"
                    >
                      <Globe className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>{platform}</span>
                      <ExternalLink className="h-3 w-3 opacity-70" />
                    </a>
                  ) : (
                    <span
                      key={platform}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)]"
                    >
                      <Globe className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>
                        {platform}: {value}
                      </span>
                    </span>
                  );
                }
              )}
            </div>
          )}
        </section>

        {/* Published Listings by this Owner */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Published Listings by {resolvedProfile.fullName} (
                {ownerListings.length})
              </h2>
            </div>
            {isLoadingRemote && (
              <span className="text-[11px] text-[var(--ps-text-muted)]">
                Syncing live records...
              </span>
            )}
          </div>

          {ownerListings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
              No published listings found for this profile yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ownerListings.map((item) => {
                const priceLabel = getListingPriceLabel(item);
                return (
                  <div
                    key={item.id}
                    data-testid={`owner-public-listing-${item.id}`}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      {item.coverImage?.trim() ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.coverImage.trim()}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="h-36 w-full object-cover"
                        />
                      ) : (
                        <div className="h-36 w-full bg-[var(--ps-surface-alt)] flex items-center justify-center text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          {CATEGORY_LABELS[item.category]}
                        </div>
                      )}
                      <div className="p-4 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                            {CATEGORY_LABELS[item.category]}
                          </span>
                          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-500">
                            <Star className="h-3 w-3 fill-current" />
                            <span>{item.rating}</span>
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-[var(--ps-text)] line-clamp-1">
                          {item.title}
                        </h3>
                        <p className="flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
                          <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                          <span className="truncate">{item.locality}</span>
                        </p>
                        {priceLabel && (
                          <div className="text-xs font-bold text-[var(--ps-text)] pt-1">
                            {priceLabel}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="px-4 py-3 border-t border-[var(--ps-border)] flex items-center justify-between gap-2 bg-[var(--ps-surface)]">
                      <Link
                        href={`/listing/${encodeURIComponent(item.id)}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[var(--ps-accent)] hover:underline"
                      >
                        <span>View Listing Page</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            window.dispatchEvent(
                              new CustomEvent('printswift:focus-map-listing', {
                                detail: { listingId: item.id },
                              })
                            );
                          }
                          router.push('/');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                      >
                        <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                        <span>Show on Map</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
