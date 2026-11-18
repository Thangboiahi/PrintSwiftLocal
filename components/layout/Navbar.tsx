'use client';

import React, { useEffect, useState } from 'react';
import { BrandLogoStatus } from '@/components/ui/BrandLogoStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { Menu } from 'lucide-react';
import Link from 'next/link';

export { BrandLogoStatus };

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
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
            role: row.role || authRole || 'visitor',
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

  const avatarUrl = profile.avatarUrl || authAvatarUrl || '';
  const fullName = profile.fullName || authFullName || authUser?.email?.split('@')[0] || 'User';
  const role = profile.role || authRole || 'Visitor';

  return (
    <header className="sticky top-0 z-[60] bg-white dark:bg-slate-950 w-full border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <BrandLogoStatus />

        {/* Hamburger Menu Toggle & Dropdown */}
        <div className="relative flex items-center">
          {/* Navbar Trigger Button: w-8 h-8 avatar image or initials fallback */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle navigation menu"
            className="flex items-center gap-2 p-1 rounded-full text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none transition-colors"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold uppercase">
                {fullName?.charAt(0) || 'U'}
              </div>
            )}
            <Menu className="w-4 h-4 text-slate-500 mr-1" />
          </button>

          {isOpen && (
            <div className="absolute right-0 top-full mt-2 z-[70] origin-top-right w-64 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-100 dark:border-slate-800 p-2 space-y-1">
              {/* Hamburger Header: w-10 h-10 avatar next to name/role */}
              <div className="flex items-center gap-3 p-3 border-b border-slate-100 dark:border-slate-800">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="Profile"
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

              {/* Navigation Links */}
              <Link
                href="/explore"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Explore Map
              </Link>
              <Link
                href="/profile"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Profile
              </Link>
              <Link
                href="/bookmarks"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Saved Bookmarks
              </Link>
              <Link
                href="/activities"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Activity Log
              </Link>
              <Link
                href="/settings"
                onClick={() => setIsOpen(false)}
                className="block px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Settings
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Navbar;
