'use client';

import React from 'react';
import Link from 'next/link';
import { Clock, PauseCircle, PhoneCall } from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type { OperationsConfig } from '@/lib/config/types';

export type GuardedModuleKey = keyof OperationsConfig['module_switches'];

const MODULE_LABELS: Record<GuardedModuleKey, string> = {
  explore: 'Explore Directory',
  marketplace: 'Local Marketplace',
  bulletin: 'Community Bulletin',
  pick_n_drop: 'Pick N Drop Courier',
  vehicle_bookings: 'Vehicle Bookings',
  print_orders: 'Print & Digital Ordering',
  booking_venues: 'Venue & Turf Bookings',
  hotel_stays: 'Hotels & Homestays',
  shop_orders: 'Shop Catalogue Orders',
  food_orders: 'Restaurants & Food Orders',
};

interface ModulePausedGuardProps {
  module: GuardedModuleKey;
  title?: string;
  compact?: boolean;
  children: React.ReactNode;
}

export function ModulePausedGuard({
  module,
  title,
  compact = false,
  children,
}: ModulePausedGuardProps) {
  const { operations, office, identity } = useAppConfig();
  const switchConfig = operations.module_switches[module];

  if (!switchConfig || switchConfig.enabled) {
    return <>{children}</>;
  }

  const heading = title || `${MODULE_LABELS[module]} Temporarily Paused`;
  const message =
    switchConfig.pause_message.trim() ||
    `${MODULE_LABELS[module]} is temporarily paused for maintenance or local operational updates. Please check back shortly.`;

  if (compact) {
    return (
      <div
        data-testid={`module-paused-${module}`}
        className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 space-y-2.5 text-[var(--ps-text)]"
      >
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <PauseCircle className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-xs sm:text-sm font-bold leading-snug">
              {heading}
            </h3>
            <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
              {message}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-500/20 text-[11px] text-[var(--ps-text-muted)]">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            {office.operating_hours}
          </span>
          <Link
            href="/contact"
            className="inline-flex items-center gap-1 font-bold text-[var(--ps-accent)] hover:underline"
          >
            <PhoneCall className="w-3 h-3" />
            Contact Support
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`module-paused-${module}`}
      className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16"
    >
      <div className="rounded-2xl border border-amber-500/35 bg-[var(--ps-surface)] p-6 sm:p-8 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
          <PauseCircle className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            {identity.app_name} Service Notice
          </p>
          <h1 className="text-lg sm:text-xl font-bold text-[var(--ps-text)]">
            {heading}
          </h1>
          <p className="text-sm text-[var(--ps-text-muted)] leading-relaxed max-w-lg mx-auto">
            {message}
          </p>
        </div>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/explore"
            className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center hover:opacity-95 transition-opacity"
          >
            Explore Directory
          </Link>
          <Link
            href="/contact"
            className="h-9 px-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--ps-surface-alt)] transition-colors"
          >
            <PhoneCall className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
            Contact Office
          </Link>
        </div>
      </div>
    </div>
  );
}
