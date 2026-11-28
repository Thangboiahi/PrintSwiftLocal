'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Megaphone,
  Shield,
  ShieldCheck,
  Store,
  Truck,
  Users,
} from 'lucide-react';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import { WorkspaceHelpButton } from '@/components/guides/WorkspaceHelpDrawer';
import type { CanonicalWorkspaceHat } from '@/lib/auth/workspace-guard';

export interface WorkspaceRouteHeaderBarProps {
  activeHat: CanonicalWorkspaceHat;
  authorizedHats: CanonicalWorkspaceHat[];
  hatCounts?: Partial<Record<CanonicalWorkspaceHat, number>>;
  focusListingId?: string | null;
}

const HAT_META: Record<
  CanonicalWorkspaceHat,
  {
    label: string;
    href: string;
    icon: typeof Store;
  }
> = {
  owner: {
    label: 'My Businesses',
    href: '/workspace/owner',
    icon: Store,
  },
  staff: {
    label: 'Staff Desk',
    href: '/workspace/staff',
    icon: Users,
  },
  advertiser: {
    label: 'Advertiser Desk',
    href: '/workspace/advertiser',
    icon: Megaphone,
  },
  driver: {
    label: 'Driver Console',
    href: '/workspace/driver',
    icon: Truck,
  },
  mediator: {
    label: 'Dispatch Mediator',
    href: '/workspace/mediator',
    icon: ShieldCheck,
  },
  hub_manager: {
    label: 'Hub Manager',
    href: '/workspace/hub',
    icon: Building2,
  },
  master_control: {
    label: 'Master Control',
    href: '/admin',
    icon: Shield,
  },
};

const DISPLAY_ORDER: CanonicalWorkspaceHat[] = [
  'owner',
  'staff',
  'advertiser',
  'driver',
  'mediator',
  'hub_manager',
  'master_control',
];

export function WorkspaceRouteHeaderBar({
  activeHat,
  authorizedHats,
  hatCounts = {},
  focusListingId,
}: WorkspaceRouteHeaderBarProps) {
  const orderedHats = DISPLAY_ORDER.filter(
    (hat) => authorizedHats.includes(hat) || hat === activeHat
  );

  const handleExploreClick = () => {
    triggerUnmountOverlaysToMap();
    if (focusListingId && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:focus-map-listing', {
          detail: { listingId: focusListingId },
        })
      );
    }
  };

  return (
    <div
      data-testid="workspace-hat-shell"
      data-active-hat={activeHat}
      className="sticky top-[var(--header-visible-height,56px)] z-[40] border-b border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-md transition-[top] duration-300 ease-out"
    >
      <div className="mx-auto w-full max-w-7xl min-w-0 px-3 sm:px-5 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <nav
          aria-label="Operational workspace hats"
          data-testid="workspace-hat-switcher-bar"
          data-tour="workspace-hat-switcher"
          className="flex items-center gap-1.5 shrink-0"
        >
          {orderedHats.map((hatKey) => {
            const meta = HAT_META[hatKey];
            const Icon = meta.icon;
            const isSelected = activeHat === hatKey;
            const count = hatCounts[hatKey];

            return (
              <Link
                key={hatKey}
                href={meta.href}
                aria-current={isSelected ? 'page' : undefined}
                data-testid={`workspace-hat-tab-${hatKey}`}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{meta.label}</span>
                {typeof count === 'number' && count > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums ${
                      isSelected
                        ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 shrink-0">
          <WorkspaceHelpButton
            roleId={activeHat === 'master_control' ? 'super_admin' : activeHat}
            label="Role Guide"
            testId="workspace-hat-role-guide-btn"
          />
          <Link
            href="/explore"
            onClick={handleExploreClick}
            className="h-11 min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Explore Map</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceRouteHeaderBar;
