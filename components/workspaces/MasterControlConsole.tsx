'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BadgePercent,
  Bot,
  Building2,
  Compass,
  CreditCard,
  Crown,
  Gift,
  Globe,
  Landmark,
  Megaphone,
  Power,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Archive,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  notifyAppConfigUpdated,
  useAppConfig,
  useHub,
} from '@/components/providers/AppConfigProvider';
import {
  WorkspaceHeaderSkeleton,
  WorkspaceKpiGridSkeleton,
} from '@/components/shared/Skeletons';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

const SubTabSkeleton = () => (
  <div className="space-y-3 py-2">
    <div className="dd-shimmer h-24 w-full rounded-2xl border border-[var(--ps-border)]" />
    <div className="dd-shimmer h-64 w-full rounded-2xl border border-[var(--ps-border)]" />
  </div>
);

const BannersOffersTab = dynamic(
  () =>
    import('./master-control/BannersOffersTab').then((m) => m.BannersOffersTab),
  { ssr: false, loading: SubTabSkeleton }
);
const BrandOfficeLegalTab = dynamic(
  () =>
    import('./master-control/BrandOfficeLegalTab').then(
      (m) => m.BrandOfficeLegalTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const HelpbotFaqTab = dynamic(
  () =>
    import('./master-control/HelpbotAndOpsTabs').then((m) => m.HelpbotFaqTab),
  { ssr: false, loading: SubTabSkeleton }
);
const OperationsSwitchesTab = dynamic(
  () =>
    import('./master-control/HelpbotAndOpsTabs').then(
      (m) => m.OperationsSwitchesTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const HubsAndRatesTab = dynamic(
  () =>
    import('./master-control/HubsAndRatesTab').then((m) => m.HubsAndRatesTab),
  { ssr: false, loading: SubTabSkeleton }
);
const PaymentsGatewayTab = dynamic(
  () =>
    import('./master-control/PaymentsGatewayTab').then(
      (m) => m.PaymentsGatewayTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const PricingSubsPromosTab = dynamic(
  () =>
    import('./master-control/PricingSubsPromosTab').then(
      (m) => m.PricingSubsPromosTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const PrintAndSettlementsTab = dynamic(
  () =>
    import('./master-control/PrintAndSettlementsTab').then(
      (m) => m.PrintAndSettlementsTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const TaxonomyGeofenceTab = dynamic(
  () =>
    import('./master-control/TaxonomyGeofenceTab').then(
      (m) => m.TaxonomyGeofenceTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const LooseEndsAndMediaTab = dynamic(
  () =>
    import('./master-control/LooseEndsAndMediaTab').then(
      (m) => m.LooseEndsAndMediaTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const UsersDriversManagersTab = dynamic(
  () =>
    import('./master-control/UsersDriversManagersTab').then(
      (m) => m.UsersDriversManagersTab
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const CivicDirectoryManager = dynamic(
  () =>
    import('./civic/CivicDirectoryManager').then(
      (m) => m.CivicDirectoryManager
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const PartnerApplicationsPanel = dynamic(
  () =>
    import('./governance/PartnerApplicationsPanel').then(
      (m) => m.PartnerApplicationsPanel
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const ReferralsTrackingPanel = dynamic(
  () =>
    import('./governance/ReferralsTrackingPanel').then(
      (m) => m.ReferralsTrackingPanel
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const FeaturedPlacementsPanel = dynamic(
  () =>
    import('./governance/FeaturedPlacementsPanel').then(
      (m) => m.FeaturedPlacementsPanel
    ),
  { ssr: false, loading: SubTabSkeleton }
);
const ListingReviewsPanel = dynamic(
  () =>
    import('./shared/ListingReviewsPanel').then((m) => m.ListingReviewsPanel),
  { ssr: false, loading: SubTabSkeleton }
);

export type MasterControlSubTab =
  | 'hubs_rates'
  | 'partner_applications'
  | 'listing_reviews'
  | 'referrals'
  | 'featured_placements'
  | 'payments'
  | 'print_settlements'
  | 'loose_ends_media'
  | 'users_drivers_managers'
  | 'public_civic'
  | 'brand_legal'
  | 'taxonomy'
  | 'pricing_subs'
  | 'helpbot'
  | 'operations'
  | 'banners_offers';

interface MasterControlConsoleProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
  controlledSubTab?: MasterControlSubTab;
  hideChrome?: boolean;
}

const SUB_TABS: Array<{
  id: MasterControlSubTab;
  label: string;
  icon: typeof CreditCard;
}> = [
  { id: 'hubs_rates', label: 'Hubs & Rates', icon: Globe },
  { id: 'partner_applications', label: 'Partner Apps & KYC', icon: UserCheck },
  { id: 'listing_reviews', label: 'Listing Reviews', icon: ShieldCheck },
  { id: 'referrals', label: 'Referrals & Fees', icon: Gift },
  { id: 'featured_placements', label: 'Featured Slots', icon: Sparkles },
  { id: 'payments', label: 'Payments & Gateway', icon: CreditCard },
  { id: 'print_settlements', label: 'Print & Settlements', icon: Printer },
  { id: 'loose_ends_media', label: 'Loose-Ends & Media', icon: Archive },
  { id: 'users_drivers_managers', label: 'Users, Drivers & Managers', icon: Users },
  { id: 'public_civic', label: 'Public & Civic', icon: Landmark },
  { id: 'brand_legal', label: 'Brand, Office & Legal', icon: Building2 },
  { id: 'taxonomy', label: 'Taxonomy & Geofence', icon: Compass },
  { id: 'pricing_subs', label: 'Pricing, Subs & Promos', icon: BadgePercent },
  { id: 'helpbot', label: 'Helpbot Q&A', icon: Bot },
  { id: 'operations', label: 'Operations & Switches', icon: Power },
  { id: 'banners_offers', label: 'Banners & Offers', icon: Megaphone },
];

export function MasterControlConsole({
  onNotice,
  controlledSubTab,
  hideChrome = false,
}: MasterControlConsoleProps) {
  const { user, realRole } = useAuth();
  const { hubs } = useHub();
  const {
    identity,
    office,
    paymentConfig,
    operations,
    surcharges,
    legal,
    isLoading: configLoading,
    refreshConfig,
  } = useAppConfig();

  const [internalSubTab, setInternalSubTab] =
    useState<MasterControlSubTab>(controlledSubTab || 'payments');
  const activeSubTab: MasterControlSubTab = controlledSubTab || internalSubTab;
  const setActiveSubTab = setInternalSubTab;
  const [verifiedSuperAdmin, setVerifiedSuperAdmin] = useState<boolean | null>(
    null
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyNonce, setVerifyNonce] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Strict DB verification for super_admin gate (always settles in try/catch/finally)
  useEffect(() => {
    let active = true;
    const verify = async () => {
      setVerifyError(null);
      try {
        if (!isSupabaseConfigured() || !user?.id) {
          if (active) setVerifiedSuperAdmin(realRole === 'super_admin');
          return;
        }
        if (realRole === 'super_admin') {
          if (active) setVerifiedSuperAdmin(true);
          return;
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setVerifyError(error.message || 'Unable to verify Super-Admin access.');
          setVerifiedSuperAdmin(false);
          return;
        }
        setVerifiedSuperAdmin(
          String(data?.role || '')
            .trim()
            .toLowerCase() === 'super_admin'
        );
      } catch (err) {
        if (!active) return;
        setVerifyError(
          err instanceof Error
            ? err.message
            : 'Unable to verify Super-Admin access.'
        );
        setVerifiedSuperAdmin(false);
      }
    };
    void verify();
    return () => {
      active = false;
    };
  }, [user?.id, realRole, verifyNonce]);

  const handleRefreshGlobal = useCallback(async () => {
    setIsRefreshing(true);
    try {
      notifyAppConfigUpdated();
      await refreshConfig(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshConfig]);

  const userId = user?.id ?? null;

  const handleSavePlatformSetting = useCallback(
    async (
      key: string,
      value: unknown,
      successMessage: string
    ): Promise<boolean> => {
      setAppStatus('saving', 'Saving platform configuration...');
      try {
        const { error } = await supabase.from('platform_settings').upsert(
          {
            key,
            value,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

        if (error) {
          setAppStatus('error', error.message);
          onNotice?.({ type: 'error', text: error.message });
          return false;
        }

        notifyAppConfigUpdated();
        await refreshConfig(true);
        setAppStatus('success', successMessage);
        onNotice?.({ type: 'success', text: successMessage });
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to save setting.';
        setAppStatus('error', msg);
        onNotice?.({ type: 'error', text: msg });
        return false;
      }
    },
    [userId, refreshConfig, onNotice]
  );

  if (verifiedSuperAdmin === null) {
    return (
      <div className="space-y-3">
        <WorkspaceHeaderSkeleton />
        <WorkspaceKpiGridSkeleton count={4} />
      </div>
    );
  }

  if (!verifiedSuperAdmin) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 sm:p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/20 space-y-2.5">
        <ShieldAlert className="mx-auto h-7 w-7 text-rose-500" />
        <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
          {verifyError ? 'Unable to Verify Super-Admin Access' : 'Super-Admin Access Required'}
        </h3>
        <p className="text-xs text-rose-700 dark:text-rose-300">
          {verifyError ||
            'Master Control settings are restricted strictly to the Super-Admin account.'}
        </p>
        {verifyError && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setVerifiedSuperAdmin(null);
                setVerifyNonce((n) => n + 1);
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-semibold text-[var(--btn-primary-fg)] hover:opacity-90 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry Verification</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3.5 min-w-0 max-w-full overflow-x-clip">
      {!hideChrome && (
        <>
          {/* Compact Mobile-First Header Strip */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                <Crown className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="text-base sm:text-lg font-bold leading-snug break-words text-[var(--ps-text)]">
                    Master Control Console
                  </h2>
                  <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)] shrink-0">
                    {paymentConfig.payment_mode === 'manual_only'
                      ? 'Full Manual UPI'
                      : paymentConfig.payment_mode === 'dual'
                        ? 'Dual Mode'
                        : 'Razorpay Only'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--ps-text-muted)] line-clamp-2 sm:line-clamp-none">
                  Live app-wide CMS, Razorpay/Manual gateway switch, pricing,
                  taxonomy &amp; kill switches.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isRefreshing || configLoading}
              onClick={() => void handleRefreshGlobal()}
              className="inline-flex min-h-[44px] w-full sm:w-auto shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing || configLoading ? 'animate-spin' : ''
                }`}
              />
              <span>Sync Live Config</span>
            </button>
          </div>

          {/* Compact Horizontally Scrollable Sub-Tabs */}
          <div className="no-scrollbar flex w-full max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
            {SUB_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Active Tab Content */}
      <div className="min-w-0 max-w-full">
        {activeSubTab === 'hubs_rates' && (
          <HubsAndRatesTab
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'partner_applications' && (
          <PartnerApplicationsPanel
            hubId={null}
            hubs={hubs}
            onNotice={onNotice}
          />
        )}

        {activeSubTab === 'referrals' && (
          <ReferralsTrackingPanel
            hubId={null}
            hubs={hubs}
            isSuperAdmin={true}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotice={onNotice}
          />
        )}

        {activeSubTab === 'featured_placements' && (
          <FeaturedPlacementsPanel
            scopeHubId={null}
            scopeHubName="All Hubs"
            onNotice={onNotice}
          />
        )}

        {activeSubTab === 'payments' && (
          <PaymentsGatewayTab
            initialPaymentConfig={paymentConfig}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'print_settlements' && (
          <PrintAndSettlementsTab
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'loose_ends_media' && (
          <LooseEndsAndMediaTab
            onJumpToSettlements={() => setActiveSubTab('print_settlements')}
          />
        )}

        {activeSubTab === 'users_drivers_managers' && (
          <UsersDriversManagersTab />
        )}

        {activeSubTab === 'public_civic' && (
          <CivicDirectoryManager
            hubs={hubs}
            isSuperAdmin={true}
            onNotice={onNotice}
          />
        )}

        {activeSubTab === 'brand_legal' && (
          <BrandOfficeLegalTab
            initialIdentity={identity}
            initialOffice={office}
            initialLegal={legal}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'taxonomy' && (
          <TaxonomyGeofenceTab
            initialOperations={operations}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'pricing_subs' && (
          <PricingSubsPromosTab
            initialSurcharges={surcharges}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'helpbot' && (
          <HelpbotFaqTab
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'operations' && (
          <OperationsSwitchesTab
            initialOperations={operations}
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'banners_offers' && (
          <BannersOffersTab
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
          />
        )}

        {activeSubTab === 'listing_reviews' && (
          <ListingReviewsPanel
            onReviewCompleted={() =>
              onNotice?.({
                type: 'success',
                text: 'Listing review completed and media lifecycle updated.',
              })
            }
          />
        )}
      </div>
    </div>
  );
}
