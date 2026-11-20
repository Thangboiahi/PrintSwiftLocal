'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BrandStatusLogo } from '@/components/ui/BrandStatusLogo';
import { BrandLogoStatus } from '@/components/ui/BrandLogoStatus';
import { getEffectiveRoleWithOverride, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  Activity,
  Bookmark,
  Briefcase,
  Compass,
  Home,
  Info,
  Menu,
  Newspaper,
  Settings,
  Store,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export { BrandLogoStatus, BrandStatusLogo };

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const scrollStateRef = useRef<
    WeakMap<EventTarget, { lastY: number; anchorY: number; dir: 'up' | 'down' | null }>
  >(new WeakMap());
  const { user: authUser, role: authRole, fullName: authFullName, avatarUrl: authAvatarUrl } = useAuth();
  const [profile, setProfile] = useState<{
    fullName: string;
    avatarUrl: string;
    role: string;
  }>({
    fullName: authFullName || '',
    avatarUrl: authAvatarUrl || '',
    role: authRole || 'visitor',
  });

  const authUserId = authUser?.id || '';
  const authEmail = authUser?.email || '';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleScrollEvent = (ev: Event) => {
      const target = ev.target as HTMLElement | Document | Window | null;
      if (!target) return;

      let key: EventTarget;
      let currentScrollY = 0;

      if (target === window || target === document) {
        key = window;
        currentScrollY = window.scrollY;
      } else if (
        target instanceof HTMLElement &&
        target.id === 'explore-scroll-container'
      ) {
        key = target;
        currentScrollY = target.scrollTop;
      } else {
        return;
      }

      const state = scrollStateRef.current.get(key) || {
        lastY: currentScrollY,
        anchorY: currentScrollY,
        dir: null,
      };

      if (currentScrollY <= 16) {
        state.lastY = currentScrollY;
        state.anchorY = currentScrollY;
        state.dir = 'up';
        scrollStateRef.current.set(key, state);
        setIsHeaderHidden(false);
        return;
      }

      if (currentScrollY < state.lastY) {
        if (state.dir !== 'up') {
          state.dir = 'up';
          state.anchorY = state.lastY;
        }
        if (state.anchorY - currentScrollY > 12) {
          setIsHeaderHidden(false);
          state.anchorY = currentScrollY;
        }
      } else if (currentScrollY > state.lastY) {
        if (state.dir !== 'down') {
          state.dir = 'down';
          state.anchorY = state.lastY;
        }
        if (currentScrollY > 400 && currentScrollY - state.anchorY > 80 && !isOpen) {
          setIsHeaderHidden(true);
          state.anchorY = currentScrollY;
        }
      }

      state.lastY = currentScrollY;
      scrollStateRef.current.set(key, state);
    };

    window.addEventListener('scroll', handleScrollEvent, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener('scroll', handleScrollEvent, {
        capture: true,
      });
    };
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    async function fetchProfile() {
      if (!authUserId || !isSupabaseConfigured()) {
        if (authAvatarUrl || authFullName) {
          setProfile({
            fullName: authFullName || authEmail.split('@')[0] || 'User',
            avatarUrl: authAvatarUrl || '',
            role: authRole || 'visitor',
          });
        }
        return;
      }
      try {
        const { data } = await supabase
          .from('profiles')
          .select('full_name, name, avatar_url, role')
          .eq('id', authUserId)
          .maybeSingle();

        if (active && data) {
          const row = data as {
            full_name?: string | null;
            name?: string | null;
            avatar_url?: string | null;
            role?: string | null;
          };
          setProfile({
            fullName: (row.full_name || row.name || authFullName || authEmail.split('@')[0] || 'User').trim(),
            avatarUrl: (row.avatar_url || authAvatarUrl || '').trim(),
            role: getEffectiveRoleWithOverride(row.role || authRole || 'visitor'),
          });
        }
      } catch {
        // ignore fetch error
      }
    }
    void fetchProfile();
    return () => {
      active = false;
    };
  }, [authUserId, authEmail, authAvatarUrl, authFullName, authRole]);

  const pathname = usePathname() || '/';
  const avatarUrl = profile.avatarUrl || authAvatarUrl || '';
  const fullName = profile.fullName || authFullName || authUser?.email?.split('@')[0] || 'User';
  const role = getEffectiveRoleWithOverride(profile.role || authRole || 'visitor').toLowerCase();
  const isSignedIn = Boolean(authUser);
  const canAccessWorkspace = ['owner', 'staff', 'admin', 'super_admin'].includes(role);

  const primaryTabs = [
    { id: 'home', label: 'Home', href: '/', icon: Home, active: pathname === '/' },
    { id: 'explore', label: 'Explore', href: '/explore', icon: Compass, active: pathname.startsWith('/explore') },
    { id: 'market', label: 'Market', href: '/marketplace', icon: Store, active: pathname.startsWith('/marketplace') },
    { id: 'bulletin', label: 'Bulletin', href: '/bulletin', icon: Newspaper, active: pathname.startsWith('/bulletin') },
  ];

  return (
    <motion.header
      initial={false}
      animate={{ y: isHeaderHidden ? '-100%' : '0%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className={`sticky top-0 z-[60] bg-white/95 dark:bg-slate-950/95 backdrop-blur-md w-full border-b border-slate-200 dark:border-slate-800 ${
        isHeaderHidden ? 'pointer-events-none' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
        <BrandStatusLogo />

        {/* Desktop 4-Tab Public Discovery Navigation */}
        <nav
          aria-label="Primary application navigation"
          className="nav-top-responsive items-center gap-1 shrink-0"
        >
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={tab.active ? 'page' : undefined}
                className={`h-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs transition-colors ${
                  tab.active
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold shadow-2xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Hamburger Menu Toggle & Dropdown */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle navigation menu"
            className="h-9 flex items-center justify-center gap-2 px-2.5 rounded-full text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none transition-colors"
          >
            {isSignedIn ? (
              avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold uppercase">
                  {fullName?.charAt(0) || 'U'}
                </div>
              )
            ) : (
              <Menu className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {isOpen && (
            <div className="absolute right-0 top-full mt-2 z-[70] origin-top-right w-64 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 p-2 space-y-1">
              {isSignedIn && (
                <>
                  {/* Hamburger Header: w-10 h-10 avatar next to name/role */}
                  <div className="flex items-center gap-3 p-3 border-b border-slate-100 dark:border-slate-800">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl}
                        alt="Profile"
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 text-sm font-bold uppercase shrink-0">
                        {fullName?.charAt(0) || 'U'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                        {fullName}
                      </div>
                      <div className="text-xs text-slate-500 capitalize">
                        {role}
                      </div>
                    </div>
                  </div>

                  {/* User Section */}
                  <div className="space-y-0.5 pt-1">
                    <Link
                      href="/profile"
                      onClick={() => setIsOpen(false)}
                      className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <User className="w-4 h-4 text-sky-500 shrink-0" />
                      <span>Profile</span>
                    </Link>
                    <Link
                      href="/saved"
                      onClick={() => setIsOpen(false)}
                      className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Bookmark className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>Saved</span>
                    </Link>
                    <Link
                      href="/activity"
                      onClick={() => setIsOpen(false)}
                      className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>Activity</span>
                    </Link>
                    {canAccessWorkspace && (
                      <Link
                        href="/workspace"
                        onClick={() => setIsOpen(false)}
                        className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Briefcase className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>Workspace</span>
                      </Link>
                    )}
                  </div>
                </>
              )}

              {/* Public Section: Always visible */}
              <div className={isSignedIn ? 'pt-1 mt-1 border-t border-slate-100 dark:border-slate-800 space-y-0.5' : 'space-y-0.5'}>
                <Link
                  href="/settings"
                  onClick={() => setIsOpen(false)}
                  className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Settings</span>
                </Link>
                <Link
                  href="/about"
                  onClick={() => setIsOpen(false)}
                  className="h-9 flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Info className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>About &amp; Contact</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.header>
  );
}

export default Navbar;
