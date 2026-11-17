'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  Building2,
  CheckCircle2,
  Compass,
  Edit3,
  ExternalLink,
  Globe,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Save,
  Settings,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  Breadcrumbs,
  triggerUnmountOverlaysToMap,
} from '@/components/navigation/Breadcrumbs';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
  SocialPlatformIcon,
  resolveSocialLinkHref,
} from '@/components/navigation/Header';
import { MediaUploader } from '@/components/shared/MediaUploader';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import { ADMIN_ROLE_DESCRIPTIONS, CATEGORY_LABELS } from '@/lib/rules';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { ListingCategory } from '@/lib/types';

interface SavedListingSummary {
  id: string;
  title: string;
  category: ListingCategory;
  locality: string;
  ownerId: string;
  ownerName: string;
}

function formatRoleLabel(rawRole: string): string {
  const normalized = rawRole.trim().toLowerCase();
  switch (normalized) {
    case 'visitor':
    case 'user':
      return 'Visitor';
    case 'owner':
    case 'business_owner':
      return 'Business Owner';
    case 'staff':
    case 'agent':
      return 'Staff / Agent';
    case 'admin':
    case 'super_admin':
      return 'Super Admin';
    default:
      return (
        normalized
          .split(/[_-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ') || 'Visitor'
      );
  }
}

interface SocialLinkItem {
  id: string;
  platform: string;
  url: string;
}

const PRESET_PLATFORMS = [
  'WhatsApp',
  'Instagram',
  'Facebook',
  'X / Twitter',
  'LinkedIn',
  'YouTube',
  'Website',
];

function recordToSocialItems(record: Record<string, string>): SocialLinkItem[] {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return [
      { id: 'soc-1', platform: 'WhatsApp', url: '' },
      { id: 'soc-2', platform: 'Instagram', url: '' },
      { id: 'soc-3', platform: 'Facebook', url: '' },
    ];
  }
  return entries.map(([platform, url], idx) => ({
    id: `soc-${idx}-${Date.now()}`,
    platform,
    url,
  }));
}

function ProfileContent() {
  const router = useRouter();
  const { currentUser, listings, savedListingIds, toggleSavedListing } =
    useAppStore();
  const { user: authUser, signOut } = useAuth();

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [supabaseSavedListings, setSupabaseSavedListings] = useState<
    SavedListingSummary[] | null
  >(null);
  const [isEditSlideOverOpen, setIsEditSlideOverOpen] = useState(false);
  const [optimisticBanner, setOptimisticBanner] = useState<string | null>(null);

  const [profileState, setProfileState] = useState<{
    fullName: string;
    email: string;
    phone: string;
    role: string;
    avatarUrl: string;
    socialLinks: Record<string, string>;
  }>({
    fullName:
      (authUser?.user_metadata?.full_name as string | undefined) ||
      authUser?.email?.split('@')[0] ||
      currentUser.name,
    email: authUser?.email || currentUser.email,
    phone: authUser?.phone || '+91 98620 00000',
    role: currentUser.adminRole || currentUser.roleType || 'visitor',
    avatarUrl: '',
    socialLinks: {
      WhatsApp: '+91 98620 00000',
      Instagram: '@printswift_lamka',
      Facebook: 'PrintSwiftLamka',
    },
  });

  // Slide-over draft state
  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftAvatarUrl, setDraftAvatarUrl] = useState('');
  const [draftSocials, setDraftSocials] = useState<SocialLinkItem[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftStatus, setDraftStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadUserProfile() {
      const defaultName =
        (authUser?.user_metadata?.full_name as string | undefined) ||
        authUser?.email?.split('@')[0] ||
        currentUser.name;
      const defaultEmail = authUser?.email || currentUser.email;
      const defaultPhone = authUser?.phone || '+91 98620 00000';
      const defaultRole =
        currentUser.adminRole || currentUser.roleType || 'visitor';

      let cachedOptimistic: Partial<OptimisticProfilePayload> | null = null;
      if (typeof window !== 'undefined') {
        try {
          const rawCached = localStorage.getItem(OPTIMISTIC_PROFILE_STORAGE_KEY);
          if (rawCached) {
            cachedOptimistic = JSON.parse(
              rawCached
            ) as Partial<OptimisticProfilePayload>;
          }
        } catch {
          // ignore
        }
      }

      if (!isSupabaseConfigured()) {
        if (active) {
          setProfileState((prev) => ({
            ...prev,
            fullName: cachedOptimistic?.fullName || defaultName,
            email: defaultEmail,
            phone: cachedOptimistic?.phone || defaultPhone,
            role: cachedOptimistic?.role || defaultRole,
            avatarUrl: cachedOptimistic?.avatarUrl || prev.avatarUrl || '',
            socialLinks:
              cachedOptimistic?.socialLinks &&
              Object.keys(cachedOptimistic.socialLinks).length > 0
                ? cachedOptimistic.socialLinks
                : prev.socialLinks,
          }));
          setIsLoadingProfile(false);
        }
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUser = sessionData?.session?.user;
        const targetId = sessionUser?.id || authUser?.id;

        if (active) {
          setHasActiveSession(Boolean(sessionData?.session));
        }

        if (!targetId) {
          if (active) {
            setProfileState((prev) => ({
              ...prev,
              fullName: cachedOptimistic?.fullName || defaultName,
              email: defaultEmail,
              phone: cachedOptimistic?.phone || defaultPhone,
              role: cachedOptimistic?.role || defaultRole,
              avatarUrl: cachedOptimistic?.avatarUrl || prev.avatarUrl || '',
              socialLinks:
                cachedOptimistic?.socialLinks &&
                Object.keys(cachedOptimistic.socialLinks).length > 0
                  ? cachedOptimistic.socialLinks
                  : prev.socialLinks,
            }));
            setIsLoadingProfile(false);
          }
          return;
        }

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', targetId)
          .maybeSingle();

        if (active && data) {
          const row = data as Record<string, unknown>;
          const parsedSocials: Record<string, string> = {};
          if (
            row.social_links &&
            typeof row.social_links === 'object' &&
            !Array.isArray(row.social_links)
          ) {
            for (const [k, v] of Object.entries(
              row.social_links as Record<string, unknown>
            )) {
              if (typeof v === 'string' && v.trim()) {
                parsedSocials[k] = v.trim();
              }
            }
          }

          const sessionMeta = sessionUser?.user_metadata as
            | Record<string, unknown>
            | undefined;

          setProfileState({
            fullName: String(
              cachedOptimistic?.fullName ||
                row.full_name ||
                row.name ||
                sessionMeta?.full_name ||
                defaultName
            ),
            email: String(row.email || sessionUser?.email || defaultEmail),
            phone: String(
              cachedOptimistic?.phone ||
                row.phone ||
                row.contact_phone ||
                sessionUser?.phone ||
                defaultPhone
            ),
            role: String(row.role || row.role_type || defaultRole),
            avatarUrl: String(
              cachedOptimistic?.avatarUrl ||
                row.avatar_url ||
                sessionMeta?.avatar_url ||
                ''
            ),
            socialLinks:
              cachedOptimistic?.socialLinks &&
              Object.keys(cachedOptimistic.socialLinks).length > 0
                ? cachedOptimistic.socialLinks
                : Object.keys(parsedSocials).length > 0
                  ? parsedSocials
                  : {
                      WhatsApp: String(row.phone || defaultPhone),
                    },
          });

          const dbSavedIds = Array.isArray(row.saved_listing_ids)
            ? row.saved_listing_ids.filter(
                (id): id is string =>
                  typeof id === 'string' && id.trim().length > 0
              )
            : [];

          if (dbSavedIds.length > 0) {
            const { data: savedRows } = await supabase
              .from('listings')
              .select('id, title, category, locality, owner_id, owner_name')
              .in('id', dbSavedIds);

            if (active && Array.isArray(savedRows)) {
              setSupabaseSavedListings(
                savedRows.map((item) => {
                  const rec = item as Record<string, unknown>;
                  return {
                    id: String(rec.id || ''),
                    title: String(rec.title || 'Untitled Listing'),
                    category: String(
                      rec.category || 'business'
                    ) as ListingCategory,
                    locality: String(rec.locality || 'Churachandpur'),
                    ownerId: String(rec.owner_id || 'owner-1'),
                    ownerName: String(rec.owner_name || 'Listing Owner'),
                  };
                })
              );
            }
          } else if (active) {
            setSupabaseSavedListings([]);
          }
        } else if (active) {
          const sessionMeta = sessionUser?.user_metadata as
            | Record<string, unknown>
            | undefined;
          setProfileState((prev) => ({
            ...prev,
            fullName:
              cachedOptimistic?.fullName ||
              (sessionMeta?.full_name as string | undefined) ||
              defaultName,
            email: sessionUser?.email || defaultEmail,
            phone:
              cachedOptimistic?.phone || sessionUser?.phone || defaultPhone,
            role: defaultRole,
            avatarUrl:
              cachedOptimistic?.avatarUrl ||
              (sessionMeta?.avatar_url as string | undefined) ||
              '',
            socialLinks: cachedOptimistic?.socialLinks || prev.socialLinks,
          }));
        }
      } catch {
        // Keep local fallback
      } finally {
        if (active) setIsLoadingProfile(false);
      }
    }

    void loadUserProfile();

    return () => {
      active = false;
    };
  }, [
    authUser,
    currentUser.name,
    currentUser.email,
    currentUser.roleType,
    currentUser.adminRole,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleProfileUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<OptimisticProfilePayload>).detail;
      if (!detail) return;
      setProfileState((prev) => ({
        ...prev,
        fullName: detail.fullName || prev.fullName,
        phone: detail.phone || prev.phone,
        avatarUrl: detail.avatarUrl ?? prev.avatarUrl,
        socialLinks: detail.socialLinks || prev.socialLinks,
      }));
    };
    window.addEventListener('printswift:profile-updated', handleProfileUpdated);
    return () => {
      window.removeEventListener(
        'printswift:profile-updated',
        handleProfileUpdated
      );
    };
  }, []);

  const handleOpenEditSlideOver = () => {
    setDraftName(profileState.fullName);
    setDraftPhone(profileState.phone);
    setDraftAvatarUrl(profileState.avatarUrl);
    setDraftSocials(recordToSocialItems(profileState.socialLinks));
    setDraftStatus(null);
    setIsEditSlideOverOpen(true);
  };

  const handleSaveSlideOver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingDraft) return;

    const cleanedName = draftName.trim();
    if (!cleanedName || cleanedName.length < 2) {
      setDraftStatus({
        type: 'error',
        text: 'Full name is required (at least 2 characters).',
      });
      return;
    }

    const socialPayload: Record<string, string> = {};
    for (const item of draftSocials) {
      const k = item.platform.trim();
      const v = item.url.trim();
      if (k && v) socialPayload[k] = v;
    }

    const optimisticPayload: OptimisticProfilePayload = {
      fullName: cleanedName,
      phone: draftPhone.trim(),
      avatarUrl: draftAvatarUrl.trim(),
      socialLinks: socialPayload,
    };

    // Immediate Optimistic UI Update
    setProfileState((prev) => ({
      ...prev,
      fullName: optimisticPayload.fullName,
      phone: optimisticPayload.phone,
      avatarUrl: optimisticPayload.avatarUrl,
      socialLinks: optimisticPayload.socialLinks,
    }));
    setOptimisticBanner(
      `Profile changes for ${optimisticPayload.fullName} applied immediately.`
    );

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          OPTIMISTIC_PROFILE_STORAGE_KEY,
          JSON.stringify(optimisticPayload)
        );
      } catch {
        // ignore
      }
      window.dispatchEvent(
        new CustomEvent('printswift:profile-updated', {
          detail: optimisticPayload,
        })
      );
    }

    setIsSavingDraft(true);
    try {
      if (isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUser = sessionData?.session?.user ?? authUser;
        const targetId = activeUser?.id || currentUser.id;

        await supabase.from('profiles').upsert(
          {
            id: targetId,
            email: activeUser?.email || currentUser.email,
            full_name: cleanedName,
            name: cleanedName,
            phone: draftPhone.trim() || null,
            avatar_url: draftAvatarUrl.trim() || null,
            social_links: socialPayload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );
      }
      setDraftStatus({
        type: 'success',
        text: 'Saved! Optimistic updates are live across your profile.',
      });
    } catch {
      setDraftStatus({
        type: 'success',
        text: 'Applied optimistically in your active session.',
      });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const fallbackSavedListings: SavedListingSummary[] = listings
    .filter((l) => savedListingIds.includes(l.id))
    .map((l) => ({
      id: l.id,
      title: l.title,
      category: l.category,
      locality: l.locality,
      ownerId: l.ownerId || 'owner-1',
      ownerName: l.ownerName || 'Listing Owner',
    }));

  const savedListings =
    supabaseSavedListings !== null && supabaseSavedListings.length > 0
      ? supabaseSavedListings
      : fallbackSavedListings;

  const handleSignOut = async () => {
    try {
      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }
      await signOut();
    } finally {
      router.push('/');
    }
  };

  const handleRemoveSavedListing = async (listingId: string) => {
    toggleSavedListing(listingId);
    setSupabaseSavedListings((prev) =>
      prev ? prev.filter((item) => item.id !== listingId) : prev
    );
    if (isSupabaseConfigured()) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id || authUser?.id;
        if (userId) {
          const remainingIds = savedListings
            .filter((item) => item.id !== listingId)
            .map((item) => item.id);
          await supabase
            .from('profiles')
            .update({ saved_listing_ids: remainingIds })
            .eq('id', userId);
        }
      } catch {
        // Ignore non-fatal sync error
      }
    }
  };

  const isAdmin =
    currentUser.roleType === 'admin' ||
    Boolean(currentUser.adminRole) ||
    profileState.role === 'admin' ||
    profileState.role === 'super_admin';

  const handleNavigateWorkspace = (
    destination: 'explore' | 'owner' | 'admin'
  ) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:navigate-destination', {
          detail: { destination },
        })
      );
    }
    triggerUnmountOverlaysToMap();
    router.push('/');
  };

  const socialEntries = Object.entries(profileState.socialLinks).filter(
    ([, val]) => Boolean(val && val.trim())
  );

  return (
    <main
      data-testid="user-profile-page"
      className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <Breadcrumbs items={[{ label: 'User Profile' }]} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={handleOpenEditSlideOver}
              data-testid="open-edit-profile-slideover-btn"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3.5 py-1.5 text-[var(--ps-text)] shadow-2xs transition hover:border-[var(--ps-accent)]"
            >
              <Edit3 className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Edit Profile</span>
            </button>
            <Link
              href="/messages"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3.5 py-1.5 text-[var(--ps-text)] shadow-2xs transition hover:border-[var(--ps-accent)]"
            >
              <MessageSquare className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Messages</span>
            </Link>
            <Link
              href="/settings"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3.5 py-1.5 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Account Settings</span>
            </Link>
            <button
              type="button"
              onClick={() => handleNavigateWorkspace('explore')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-1.5 text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Map Discovery</span>
            </button>
          </div>
        </div>

        {optimisticBanner && (
          <div
            role="status"
            aria-live="polite"
            data-testid="profile-optimistic-banner"
            className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{optimisticBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setOptimisticBanner(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {isLoadingProfile ? (
          <ProfileSkeleton />
        ) : (
          <>
            {/* Account Summary & Social Channels Card */}
            <section
              data-testid="profile-account-summary-card"
              className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs">
                    {profileState.avatarUrl.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profileState.avatarUrl.trim()}
                        alt={profileState.fullName}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-7 w-7" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1
                        data-testid="profile-display-name"
                        className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]"
                      >
                        {profileState.fullName}
                      </h1>
                      <span
                        data-testid="profile-active-role-badge"
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-500/25 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400"
                      >
                        <Shield className="h-3 w-3" />
                        <span>{formatRoleLabel(profileState.role)}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ps-text-muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                        <span>{profileState.email}</span>
                      </span>
                      {profileState.phone && (
                        <span className="inline-flex items-center gap-1.5 font-mono">
                          <Phone className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>{profileState.phone}</span>
                        </span>
                      )}
                    </div>

                    {currentUser.adminRole && (
                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                        {ADMIN_ROLE_DESCRIPTIONS[currentUser.adminRole]}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenEditSlideOver}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit Profile</span>
                  </button>

                  {hasActiveSession || authUser ? (
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      data-testid="profile-sign-out-btn"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      <LogIn className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>Sign In</span>
                    </Link>
                  )}
                </div>
              </div>

              {/* Clickable Social Links Icons Bar */}
              <div
                data-testid="profile-social-links-bar"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-800 pt-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                    Connected Socials:
                  </span>
                  {socialEntries.length === 0 ? (
                    <span className="text-xs text-[var(--ps-text-muted)]">
                      No social links configured yet.
                    </span>
                  ) : (
                    socialEntries.map(([platform, rawVal]) => {
                      const href = resolveSocialLinkHref(platform, rawVal);
                      return (
                        <a
                          key={platform}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${platform}: ${rawVal}`}
                          aria-label={`Open ${platform} (${rawVal})`}
                          data-testid={`profile-social-icon-${platform.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                          className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)] shadow-2xs transition hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)]"
                        >
                          <SocialPlatformIcon
                            platform={platform}
                            className="h-4 w-4 text-[var(--ps-accent)]"
                          />
                          <span>{platform}</span>
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </a>
                      );
                    })
                  )}
                </div>

                <Link
                  href={`/user/${encodeURIComponent(authUser?.id || currentUser.id)}`}
                  data-testid="view-public-profile-link"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  <span>View Public Profile</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </section>

            {/* Quick Workspace Interlinking Hub */}
            <section
              data-testid="profile-workspace-interlinks"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <button
                type="button"
                onClick={() => handleNavigateWorkspace('explore')}
                className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 text-left shadow-xs transition hover:border-[var(--ps-accent)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Compass className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--ps-text)]">
                    Map Discovery
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    Interactive Lamka map
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleNavigateWorkspace('owner')}
                className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 text-left shadow-xs transition hover:border-[var(--ps-accent)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--ps-text)]">
                    My Listings
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    Owner Workspace
                  </div>
                </div>
              </button>

              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 text-left shadow-xs transition hover:border-[var(--ps-accent)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--ps-text)]">
                    Account Settings
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    Language &amp; preferences
                  </div>
                </div>
              </Link>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleNavigateWorkspace('admin')}
                  className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 text-left shadow-xs transition hover:border-[var(--ps-accent)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--ps-text)]">
                      Admin Dashboard
                    </div>
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      Moderation &amp; verification
                    </div>
                  </div>
                </button>
              )}
            </section>

            {/* Saved Listings Section */}
            <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="h-4 w-4 text-[var(--ps-accent)]" />
                  <h2 className="text-base font-bold text-[var(--ps-text)]">
                    Saved Listings ({savedListings.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => handleNavigateWorkspace('explore')}
                  className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  Explore Directory →
                </button>
              </div>

              {savedListings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    You have no saved listings yet. Bookmark properties, businesses, or landmarks from the discovery map to access them quickly here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {savedListings.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <span className="inline-block rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                            {CATEGORY_LABELS[item.category]}
                          </span>
                          <Link
                            href={`/listing/${encodeURIComponent(item.id)}`}
                            className="block text-sm font-bold text-[var(--ps-text)] truncate hover:text-[var(--ps-accent)]"
                          >
                            {item.title}
                          </Link>
                          <p className="flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
                            <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                            <span className="truncate">{item.locality}</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveSavedListing(item.id)}
                          aria-label={`Remove ${item.title} from saved listings`}
                          className="rounded-lg border border-gray-200 dark:border-gray-800 p-1.5 text-[var(--ps-text-muted)] hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-gray-200/70 dark:border-gray-800/70 pt-2.5 text-[11px]">
                        <Link
                          href={`/user/${encodeURIComponent(item.ownerId || 'owner-1')}`}
                          className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)]"
                        >
                          <User className="h-3 w-3 text-[var(--ps-accent)]" />
                          <span className="truncate">
                            {item.ownerName || 'Listing Owner'}
                          </span>
                        </Link>
                        <Link
                          href={`/listing/${encodeURIComponent(item.id)}`}
                          className="font-semibold text-[var(--ps-accent)] hover:underline"
                        >
                          Open Listing →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Seamless Slide-Over Edit Profile Modal with Immediate Optimistic Updates */}
      <AnimatePresence>
        {isEditSlideOverOpen && (
          <motion.div
            key="profile-edit-slideover-backdrop"
            data-testid="profile-edit-slideover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-[2px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsEditSlideOverOpen(false);
              }
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="h-full w-full max-w-2xl overflow-y-auto border-l border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4 sm:p-6 shadow-2xl"
            >
              <form
                onSubmit={handleSaveSlideOver}
                className="space-y-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                      Edit Profile &amp; Social Links
                    </h2>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      Changes apply immediately via optimistic UI updates and sync to Supabase.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditSlideOverOpen(false)}
                    aria-label="Close Edit Profile slide-over"
                    data-testid="close-profile-edit-slideover-btn"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {draftStatus && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
                      draftStatus.type === 'success'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {draftStatus.type === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{draftStatus.text}</span>
                  </div>
                )}

                {/* Avatar Upload */}
                <div className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)] flex items-center justify-center">
                      {draftAvatarUrl.trim() ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={draftAvatarUrl.trim()}
                          alt={draftName || 'Avatar'}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <User className="h-7 w-7 text-[var(--ps-accent)]" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="block text-xs font-bold text-[var(--ps-text)]">
                        Avatar Image URL
                      </label>
                      <input
                        type="url"
                        value={draftAvatarUrl}
                        onChange={(e) => setDraftAvatarUrl(e.target.value)}
                        placeholder="https://example.com/avatar.jpg"
                        className="w-full min-h-[38px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-1.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <MediaUploader
                    mode="image"
                    listingId={`avatar-${authUser?.id || currentUser.id}`}
                    label="Upload Avatar to Supabase Storage"
                    helperText="JPEG, PNG, or WebP up to 5 MB"
                    onUploadSuccess={(publicUrl) => setDraftAvatarUrl(publicUrl)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-[var(--ps-text)]">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-[var(--ps-text)]">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={draftPhone}
                      onChange={(e) => setDraftPhone(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Social Links */}
                <div className="space-y-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Globe className="h-4 w-4 text-[var(--ps-accent)]" />
                      <span>Social Links</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftSocials((prev) => [
                          ...prev,
                          {
                            id: `soc-${Date.now()}-${prev.length}`,
                            platform: 'Website',
                            url: '',
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)]"
                    >
                      <Plus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>Add Link</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {draftSocials.map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <select
                          value={
                            PRESET_PLATFORMS.includes(item.platform)
                              ? item.platform
                              : 'Website'
                          }
                          onChange={(e) =>
                            setDraftSocials((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, platform: e.target.value }
                                  : row
                              )
                            )
                          }
                          className="min-h-[38px] w-36 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)]"
                        >
                          {PRESET_PLATFORMS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={item.url}
                          onChange={(e) =>
                            setDraftSocials((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, url: e.target.value }
                                  : row
                              )
                            )
                          }
                          placeholder={`${item.platform} URL or handle`}
                          className="min-h-[38px] flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-3 py-1.5 text-xs text-[var(--ps-text)]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setDraftSocials((prev) =>
                              prev.filter((row) => row.id !== item.id)
                            )
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-gray-200 dark:border-gray-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsEditSlideOverOpen(false)}
                    className="rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)]"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingDraft}
                    data-testid="save-slideover-profile-btn"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs"
                  >
                    {isSavingDraft ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span>Save Changes</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <AppProvider>
      <ProtectedRoute>
        <ProfileContent />
      </ProtectedRoute>
    </AppProvider>
  );
}
