import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Compass,
  Lock,
  Megaphone,
  Shield,
  ShieldCheck,
  Store,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  getWorkspaceRouteForHat,
  normalizeWorkspaceHatParam,
  resolveServerWorkspaceContext,
  type CanonicalWorkspaceHat,
} from '@/lib/auth/workspace-guard';

/**
 * Pure Server-Component `/workspace` Dispatcher (`app/workspace/page.tsx`)
 *
 * IMPORTANT: ZERO Workspace Component Imports (0 KB of workspace JS shipped here).
 * 1. Normalizes any `?hat=<hat>` query param (`owner`, `staff`, `driver`, `mediator`,
 *    `hub`/`hub_manager`, `advertiser`, `master_control`/`admin`) and issues a server-side
 *    `redirect('/workspace/<segment>' + remainingQuery)` so legacy links and notification
 *    `action_url`s work seamlessly.
 * 2. Without `?hat=` (or when `?denied=<hat>` is present), verifies authentication and
 *    renders a minimalist Workspace Hat Launcher showing ONLY the hats the authenticated
 *    user holds (plus Partner Application CTAs for visitors).
 */

const HAT_LAUNCHER_CARDS: Record<
  CanonicalWorkspaceHat,
  {
    title: string;
    subtitle: string;
    href: string;
    icon: typeof Store;
    badgeLabel: string;
  }
> = {
  owner: {
    title: 'My Businesses (Owner Desk)',
    subtitle:
      'Manage multi-vertical listings, menus, catalogues, bookings, print jobs, real estate visits, and delegated staff.',
    href: '/workspace/owner',
    icon: Store,
    badgeLabel: 'Owner',
  },
  staff: {
    title: 'Delegated Staff Desk',
    subtitle:
      'Handle live orders, print queues, room/venue check-ins, enquiries, and property visits for assigned businesses.',
    href: '/workspace/staff',
    icon: Users,
    badgeLabel: 'Staff',
  },
  advertiser: {
    title: 'Advertiser & Bulletin Desk',
    subtitle:
      'Publish community bulletins, events, jobs, video promos, and manage Homepage & Explore featured placements.',
    href: '/workspace/advertiser',
    icon: Megaphone,
    badgeLabel: 'Advertiser',
  },
  driver: {
    title: 'Driver & Fleet Console',
    subtitle:
      'Go online for Pick N Drop jobs, verify handover OTPs, upload compressed PODs, and manage scheduled charter vehicles.',
    href: '/workspace/driver',
    icon: Truck,
    badgeLabel: 'Driver',
  },
  mediator: {
    title: 'Dispatch Mediator Desk',
    subtitle:
      'Verify customer UPI UTR proofs, assign drivers, monitor >15m SLA alerts, and settle escrow payouts or refunds.',
    href: '/workspace/mediator',
    icon: ShieldCheck,
    badgeLabel: 'Mediator',
  },
  hub_manager: {
    title: 'Regional Hub Manager Desk',
    subtitle:
      'Review local Partner/Driver KYC, moderate listings & bulletins, triage suggested L3 categories, and manage hub operations.',
    href: '/workspace/hub',
    icon: Building2,
    badgeLabel: 'Hub Manager',
  },
  master_control: {
    title: 'Master Control & Superadmin',
    subtitle:
      'Configure homepage containers, 3-level taxonomy, subscription plans, pay-per pricing, hubs, and platform audit logs.',
    href: '/admin',
    icon: Shield,
    badgeLabel: 'Superadmin',
  },
};

export default async function WorkspaceDispatcherPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawHat = typeof params?.hat === 'string' ? params.hat : null;
  const normalizedHat = normalizeWorkspaceHatParam(rawHat);

  if (normalizedHat) {
    const targetPath = getWorkspaceRouteForHat(normalizedHat);
    const remaining = new URLSearchParams();
    for (const [key, val] of Object.entries(params || {})) {
      if (key === 'hat' || val === undefined) continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          remaining.append(key, item);
        }
      } else {
        remaining.set(key, val);
      }
    }
    const qs = remaining.toString();
    redirect(qs ? `${targetPath}?${qs}` : targetPath);
  }

  const rawDenied = typeof params?.denied === 'string' ? params.denied : null;
  const ctx = await resolveServerWorkspaceContext();

  if (!ctx.isAuthenticated || !ctx.userId) {
    redirect('/login?next=%2Fworkspace');
  }

  // If the user holds exactly 1 hat and did not arrive from an access-denied redirect,
  // take them straight to their single workspace segment.
  if (!rawDenied && ctx.authorizedHats.length === 1) {
    redirect(getWorkspaceRouteForHat(ctx.authorizedHats[0]));
  }

  return (
    <main
      data-testid="workspace-hat-launcher"
      data-user-role={ctx.effectiveRole}
      className="min-h-[calc(100dvh-var(--app-header-height,56px))] w-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8"
    >
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xs">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ps-accent)]/12 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-accent)]">
              Role: {ctx.effectiveRole}
            </span>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Operational Workspaces
            </h1>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Select a workspace hat below to launch its dedicated operational console.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/guides"
              className="min-h-[44px] px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center gap-1.5 transition-colors"
            >
              <Compass className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              <span>8-Role Guides</span>
            </Link>
            <Link
              href="/explore"
              className="min-h-[44px] px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Explore Map</span>
            </Link>
          </div>
        </div>

        {/* Access Denied Alert when redirected from an unauthorized /workspace/<hat> route */}
        {rawDenied && (
          <div
            role="alert"
            data-testid="workspace-access-denied-alert"
            className="flex items-start gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-bold">
                Access Restricted for &ldquo;{rawDenied}&rdquo; Workspace
              </p>
              <p className="text-[11px] opacity-90">
                Your account ({ctx.effectiveRole}) does not currently hold the required role or partner assignment for that desk. Choose one of your active workspaces below or submit a Partner / Driver KYC application.
              </p>
            </div>
          </div>
        )}

        {/* Active Hat Cards */}
        {ctx.authorizedHats.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {ctx.authorizedHats.map((hatKey) => {
              const card = HAT_LAUNCHER_CARDS[hatKey];
              const Icon = card.icon;
              const count = ctx.hatCounts[hatKey];

              return (
                <Link
                  key={hatKey}
                  href={card.href}
                  data-testid={`workspace-launcher-card-${hatKey}`}
                  className="group rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xs hover:border-[var(--ps-accent)] transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="flex items-center gap-1.5">
                        {typeof count === 'number' && count > 0 && (
                          <span className="rounded-full bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] px-2 py-0.5 text-[10px] font-extrabold tabular-nums text-[var(--ps-text)]">
                            {count} active
                          </span>
                        )}
                        <span className="rounded-full bg-[var(--ps-accent)]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                          {card.badgeLabel}
                        </span>
                      </div>
                    </div>

                    <h2 className="text-base font-extrabold text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors">
                      {card.title}
                    </h2>
                    <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
                      {card.subtitle}
                    </p>
                  </div>

                  <div className="inline-flex min-h-[44px] items-center justify-between rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] px-3.5 text-xs font-bold text-[var(--ps-text)] group-hover:border-[var(--ps-accent)]/50 group-hover:text-[var(--ps-accent)] transition-colors">
                    <span>Open Console</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div
            data-testid="workspace-unauthorized-state"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 text-center shadow-2xs space-y-5"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <Lock className="h-7 w-7" aria-hidden="true" />
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                No Active Partner Hat • Role: {ctx.effectiveRole}
              </span>
              <h2 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                Workspace Access Required
              </h2>
              <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
                Operational workspaces are available to Business Owners, Delegated Staff, Verified Drivers, Dispatch Mediators, Hub Managers, and Administrators.
              </p>
            </div>
          </div>
        )}

        {/* Partner / Driver / Advertiser KYC Application Strip */}
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
              Expand Your Operational Hats
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Apply to list a local business, join the Pick N Drop &amp; charter driver fleet, or publish verified community bulletins.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              href="/onboarding?track=business"
              data-testid="workspace-become-partner-cta"
              className="min-h-[44px] px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Become a Partner</span>
            </Link>
            <Link
              href="/onboarding?track=driver"
              data-testid="workspace-apply-driver-cta"
              className="min-h-[44px] px-4 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-accent)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--ps-accent)]/15 transition-colors"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Apply as Driver</span>
            </Link>
            <Link
              href="/onboarding?track=advertiser"
              className="min-h-[44px] px-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <Megaphone className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              <span>Apply as Advertiser</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
