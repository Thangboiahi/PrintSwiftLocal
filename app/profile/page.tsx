'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bookmark,
  Briefcase,
  Edit3,
  ExternalLink,
  LogOut,
  MapPin,
  Settings,
  User,
} from 'lucide-react';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
  SocialPlatformIcon,
  resolveSocialLinkHref,
} from '@/components/navigation/Header';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

function formatRoleLabel(rawRole: string): string {
  const normalized = rawRole.trim().toLowerCase();
  switch (normalized) {
    case 'visitor':
    case 'user':
      return 'Visitor';
    case 'owner':
    case 'business_owner':
      return 'Owner';
    case 'staff':
    case 'agent':
      return 'Staff';
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

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function ProfileContent() {
  const router = useRouter();
  const { currentUser, savedListingIds } = useAppStore();
  const { user: authUser, role: syncedAuthRole, signOut, avatarUrl: authAvatarUrl } = useAuth();

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileState, setProfileState] = useState<{
    fullName: string;
    username: string;
    bio: string;
    role: string;
    avatarUrl: string;
    socialLinks: Record<string, string>;
  }>({
    fullName:
      (authUser?.user_metadata?.full_name as string | undefined) ||
      authUser?.email?.split('@')[0] ||
      currentUser.name ||
      'User',
    username:
      (authUser?.user_metadata?.username as string | undefined) ||
      authUser?.email?.split('@')[0]?.toLowerCase() ||
      'user',
    bio: '',
    role:
      syncedAuthRole || currentUser.adminRole || currentUser.roleType || 'visitor',
    avatarUrl: authAvatarUrl || '',
    socialLinks: {},
  });

  useEffect(() => {
    let active = true;

    async function loadUserProfile() {
      const defaultName =
        (authUser?.user_metadata?.full_name as string | undefined) ||
        authUser?.email?.split('@')[0] ||
        currentUser.name ||
        'User';
      const defaultUsername =
        (authUser?.user_metadata?.username as string | undefined) ||
        authUser?.email?.split('@')[0]?.toLowerCase() ||
        'user';
      const defaultRole =
        syncedAuthRole ||
        currentUser.adminRole ||
        currentUser.roleType ||
        'visitor';

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
          // ignore storage errors
        }
      }

      if (!isSupabaseConfigured()) {
        if (active) {
          setProfileState((prev) => ({
            ...prev,
            fullName: cachedOptimistic?.fullName || defaultName,
            username: defaultUsername,
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

        if (!targetId) {
          router.replace('/login');
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

          const safeCachedSocials =
            cachedOptimistic?.socialLinks &&
            typeof cachedOptimistic.socialLinks === 'object' &&
            !Array.isArray(cachedOptimistic.socialLinks) &&
            Object.keys(cachedOptimistic.socialLinks).length > 0
              ? cachedOptimistic.socialLinks
              : null;

          const resolvedUsername = String(
            row.username ||
              sessionMeta?.username ||
              (sessionUser?.email ? sessionUser.email.split('@')[0] : '') ||
              defaultUsername
          )
            .replace(/^@+/, '')
            .toLowerCase();

          setProfileState({
            fullName: String(
              cachedOptimistic?.fullName ||
                row.full_name ||
                row.name ||
                sessionMeta?.full_name ||
                defaultName
            ),
            username: resolvedUsername || 'user',
            bio:
              typeof row.bio === 'string' && row.bio.trim()
                ? row.bio.trim()
                : '',
            role: String(row.role || row.role_type || defaultRole),
            avatarUrl: String(
              row.avatar_url ||
                cachedOptimistic?.avatarUrl ||
                authAvatarUrl ||
                sessionMeta?.avatar_url ||
                ''
            ),
            socialLinks: safeCachedSocials
              ? safeCachedSocials
              : Object.keys(parsedSocials).length > 0
                ? parsedSocials
                : {},
          });
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
            username: String(
              sessionMeta?.username ||
                (sessionUser?.email ? sessionUser.email.split('@')[0] : '') ||
                defaultUsername
            )
              .replace(/^@+/, '')
              .toLowerCase(),
            role: defaultRole,
            avatarUrl:
              cachedOptimistic?.avatarUrl ||
              (sessionMeta?.avatar_url as string | undefined) ||
              '',
            socialLinks:
              cachedOptimistic?.socialLinks &&
              typeof cachedOptimistic.socialLinks === 'object' &&
              !Array.isArray(cachedOptimistic.socialLinks)
                ? cachedOptimistic.socialLinks
                : prev.socialLinks,
          }));
        }
      } catch {
        // Keep fallback values cleanly
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
    syncedAuthRole,
    authAvatarUrl,
    currentUser.name,
    currentUser.roleType,
    currentUser.adminRole,
    router,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleProfileUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<OptimisticProfilePayload>).detail;
      if (!detail) return;
      setProfileState((prev) => ({
        ...prev,
        fullName: detail.fullName || prev.fullName,
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

  const normalizedRole = profileState.role.trim().toLowerCase();
  const hasWorkspaceAccess =
    normalizedRole === 'owner' ||
    normalizedRole === 'staff' ||
    normalizedRole === 'super_admin';

  const socialEntries =
    profileState.socialLinks && typeof profileState.socialLinks === 'object'
      ? Object.entries(profileState.socialLinks).filter(
          ([, val]) => typeof val === 'string' && val.trim().length > 0
        )
      : [];

  const initials = getInitials(profileState.fullName);

  return (
    <div
      data-testid="user-profile-page"
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {isLoadingProfile ? (
        <ProfileSkeleton />
      ) : (
        <>
          {/* Top Section (Identity) */}
          <div
            data-testid="profile-account-summary-card"
            className="flex flex-col items-center text-center pb-8 border-b border-slate-100 dark:border-slate-800"
          >
            {profileState.avatarUrl?.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileState.avatarUrl.trim()}
                alt="Profile"
                referrerPolicy="no-referrer"
                className="w-24 h-24 rounded-full object-cover shadow-sm"
              />
            ) : (
              <div className="flex items-center justify-center w-24 h-24 rounded-full bg-blue-100 text-blue-600 text-3xl font-bold uppercase">
                {profileState.fullName?.charAt(0) || 'U'}
              </div>
            )}

            <h1
              data-testid="profile-display-name"
              className="text-2xl font-semibold mt-4 text-[var(--ps-text)]"
            >
              {profileState.fullName}
            </h1>
            <p className="text-slate-500 text-sm">
              @{profileState.username.replace(/^@+/, '')}
            </p>

            <span
              data-testid="profile-active-role-badge"
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 mt-2"
            >
              {formatRoleLabel(profileState.role)}
            </span>

            {profileState.bio && (
              <p className="max-w-lg text-sm leading-relaxed text-slate-600 dark:text-slate-400 mt-3">
                {profileState.bio}
              </p>
            )}

            {socialEntries.length > 0 && (
              <div
                data-testid="profile-social-links-bar"
                className="flex flex-wrap items-center justify-center gap-2 mt-4"
              >
                {socialEntries.map(([platform, rawVal]) => (
                  <a
                    key={platform}
                    href={resolveSocialLinkHref(platform, rawVal)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={platform}
                    aria-label={platform}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-medium text-[var(--ps-text)] hover:border-blue-500 transition-colors"
                  >
                    <SocialPlatformIcon
                      platform={platform}
                      className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                    />
                    <span>{platform}</span>
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Grid Section (Accessibles) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            <Link
              href="/profile/edit"
              data-testid="profile-hub-edit-link"
              className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Edit3 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--ps-text)]">
                  Edit Profile
                </div>
                <p className="text-xs text-slate-500 truncate">
                  Avatar, bio, and social channels
                </p>
              </div>
            </Link>

            <Link
              href="/bookmarks"
              data-testid="profile-hub-bookmarks-link"
              className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Bookmark className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--ps-text)]">
                  Saved Bookmarks
                  {savedListingIds.length > 0
                    ? ` (${savedListingIds.length})`
                    : ''}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  View and manage saved listings
                </p>
              </div>
            </Link>

            <Link
              href="/activities"
              data-testid="profile-hub-activities-link"
              className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Activity className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--ps-text)]">
                  Activity Log
                </div>
                <p className="text-xs text-slate-500 truncate">
                  Notifications and recent enquiries
                </p>
              </div>
            </Link>

            <Link
              href="/settings"
              data-testid="profile-hub-settings-link"
              className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
                <Settings className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--ps-text)]">
                  Preferences
                </div>
                <p className="text-xs text-slate-500 truncate">
                  Theme, map style, language &amp; units
                </p>
              </div>
            </Link>

            {hasWorkspaceAccess && (
              <Link
                href="/workspace"
                data-testid="profile-hub-workspace-link"
                className="sm:col-span-2 flex items-center gap-4 p-4 rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition-colors"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--ps-text)]">
                    My Workspace
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    Manage listings, verification, and {formatRoleLabel(profileState.role)} operations
                  </p>
                </div>
              </Link>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <MapPin className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>Explore Map</span>
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              data-testid="profile-sign-out-btn"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 transition hover:bg-rose-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </>
      )}
    </div>
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
