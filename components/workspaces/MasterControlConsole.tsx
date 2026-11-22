'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
  Layers,
  Megaphone,
  Power,
  Printer,
  RefreshCw,
  ShieldAlert,
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
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { BannersOffersTab } from './master-control/BannersOffersTab';
import { BrandOfficeLegalTab } from './master-control/BrandOfficeLegalTab';
import {
  HelpbotFaqTab,
  OperationsSwitchesTab,
} from './master-control/HelpbotAndOpsTabs';
import { HubsAndRatesTab } from './master-control/HubsAndRatesTab';
import { NestedCategoriesTab } from './master-control/NestedCategoriesTab';
import { PaymentsGatewayTab } from './master-control/PaymentsGatewayTab';
import { PricingSubsPromosTab } from './master-control/PricingSubsPromosTab';
import { PrintAndSettlementsTab } from './master-control/PrintAndSettlementsTab';
import { TaxonomyGeofenceTab } from './master-control/TaxonomyGeofenceTab';
import { LooseEndsAndMediaTab } from './master-control/LooseEndsAndMediaTab';
import { UsersDriversManagersTab } from './master-control/UsersDriversManagersTab';
import { CivicDirectoryManager } from './civic/CivicDirectoryManager';
import { PartnerApplicationsPanel } from './governance/PartnerApplicationsPanel';
import { ReferralsTrackingPanel } from './governance/ReferralsTrackingPanel';
import { FeaturedPlacementsPanel } from './governance/FeaturedPlacementsPanel';

type MasterControlSubTab =
  | 'hubs_rates'
  | 'partner_applications'
  | 'referrals'
  | 'featured_placements'
  | 'nested_categories'
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
}

const SUB_TABS: Array<{
  id: MasterControlSubTab;
  label: string;
  icon: typeof CreditCard;
}> = [
  { id: 'hubs_rates', label: 'Hubs & Rates', icon: Globe },
  { id: 'partner_applications', label: 'Partner Apps & KYC', icon: UserCheck },
  { id: 'referrals', label: 'Referrals & Fees', icon: Gift },
  { id: 'featured_placements', label: 'Featured Slots', icon: Sparkles },
  { id: 'nested_categories', label: 'Nested Categories', icon: Layers },
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

export function MasterControlConsole({ onNotice }: MasterControlConsoleProps) {
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

  const [activeSubTab, setActiveSubTab] =
    useState<MasterControlSubTab>('payments');
  const [verifiedSuperAdmin, setVerifiedSuperAdmin] = useState<boolean | null>(
    null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Strict DB verification for super_admin gate
  useEffect(() => {
    let active = true;
    const verify = async () => {
      if (!isSupabaseConfigured || !user?.id) {
        if (active) setVerifiedSuperAdmin(realRole === 'super_admin');
        return;
      }
      if (realRole === 'super_admin') {
        if (active) setVerifiedSuperAdmin(true);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (active) {
        setVerifiedSuperAdmin(data?.role === 'super_admin');
      }
    };
    queueMicrotask(() => {
      void verify();
    });
    return () => {
      active = false;
    };
  }, [user?.id, realRole]);

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
      <AppBrandLoader
        mode="inline"
        message="Verifying Super-Admin clearance…"
        className="min-h-[260px] rounded-xl border border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900"
      />
    );
  }

  if (!verifiedSuperAdmin) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/20">
        <ShieldAlert className="mx-auto mb-2 h-7 w-7 text-rose-500" />
        <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
          Super-Admin Access Required
        </h3>
        <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
          Master Control settings are restricted strictly to the Super-Admin
          account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5 min-w-0 max-w-full overflow-x-clip">
      {/* Compact Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <Crown className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Master Control Console
              </h2>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {paymentConfig.payment_mode === 'manual_only'
                  ? 'Full Manual UPI'
                  : paymentConfig.payment_mode === 'dual'
                    ? 'Dual Mode'
                    : 'Razorpay Only'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Live app-wide CMS, Razorpay/Manual gateway switch, pricing,
              taxonomy & kill switches.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isRefreshing || configLoading}
          onClick={() => void handleRefreshGlobal()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              isRefreshing || configLoading ? 'animate-spin' : ''
            }`}
          />
          Sync Live Config
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
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                active
                  ? 'bg-slate-900 text-white shadow-sm dark:bg-sky-600 dark:text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

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

        {activeSubTab === 'nested_categories' && (
          <NestedCategoriesTab
            onSavePlatformSetting={handleSavePlatformSetting}
            onNotify={onNotice}
            refreshGlobalConfig={handleRefreshGlobal}
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
      </div>
    </div>
  );
}
