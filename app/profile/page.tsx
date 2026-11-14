'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bookmark,
  LogIn,
  LogOut,
  MapPin,
  Settings,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import { AppProvider, useAppStore, useAuth } from '@/lib/store';
import { CATEGORY_LABELS } from '@/lib/rules';

function ProfileContent() {
  const { currentUser, listings, savedListingIds, toggleSavedListing } =
    useAppStore();
  const { user: authUser, signOut } = useAuth();

  const savedListings = listings.filter((l) => savedListingIds.includes(l.id));
  const displayEmail = authUser?.email || currentUser.email;
  const displayName =
    authUser?.user_metadata?.full_name ||
    authUser?.email?.split('@')[0] ||
    currentUser.name;

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Top Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Discovery Map</span>
          </Link>

          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link
              href="/profile"
              aria-current="page"
              className="text-[var(--ps-accent)]"
            >
              Profile
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Settings</span>
            </Link>
          </div>
        </div>

        {/* Account Summary Card */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]">
                <User className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                    {displayName}
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--ps-accent)]">
                    <Shield className="h-3 w-3" />
                    {authUser ? 'Authenticated' : currentUser.roleType}
                  </span>
                </div>
                <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                  {displayEmail}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {authUser ? (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300 transition hover:bg-rose-500/20"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>Sign In</span>
                  </Link>
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)]"
                  >
                    <span>Create Account</span>
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Saved Listings Section */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Saved Listings ({savedListings.length})
              </h2>
            </div>
            <Link
              href="/"
              className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
            >
              Explore Directory →
            </Link>
          </div>

          {savedListings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-8 text-center">
              <p className="text-xs text-[var(--ps-text-muted)]">
                You have no saved listings yet. Bookmark properties, businesses, or landmarks from the discovery map to access them quickly here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {savedListings.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4"
                >
                  <div className="space-y-1 min-w-0">
                    <span className="inline-block rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                      {item.title}
                    </h3>
                    <p className="flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{item.locality}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSavedListing(item.id)}
                    aria-label={`Remove ${item.title} from saved listings`}
                    className="rounded-lg border border-[var(--ps-border)] p-1.5 text-[var(--ps-text-muted)] hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <AppProvider>
      <ProfileContent />
    </AppProvider>
  );
}
