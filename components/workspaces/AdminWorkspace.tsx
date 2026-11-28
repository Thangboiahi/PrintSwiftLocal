'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  AlertTriangle,
  BadgePercent,
  Building2,
  CheckCircle2,
  CreditCard,
  Crown,
  Database,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Flag,
  FolderTree,
  Gift,
  Globe,
  IndianRupee,
  Landmark,
  Layers,
  LayoutGrid,
  Loader2,
  Lock,
  MapPin,
  Newspaper,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Sliders,
  Trash2,
  Truck,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { CHURACHANDPUR_FALLBACK_CENTER } from '@/lib/maps/coordinates';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isUuid } from '@/lib/payments/types';
import {
  fetchAllUsers,
  fetchAppSettings,
  isSampleListing,
  mapGovernedRoleToAccountFields,
  normalizeGovernedRole,
  updateAppSetting,
  updateUserRole,
  type GovernedUserRole,
} from '@/lib/supabase/admin';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  createListing,
  fetchListings,
  updateListing,
} from '@/lib/supabase/listings';
import {
  deleteTranslationKeyGroup,
  fetchAllTranslationEntries,
  upsertTranslationKeyGroup,
  type SupportedLocale,
  type TranslationMatrixEntry,
} from '@/lib/supabase/translations';
import { exportListingsToCsv } from '@/lib/utils/export';
import { parseListingsCsvFile } from '@/lib/utils/import';
import {
  AdminRole,
  DynamicFieldDefinition,
  Listing,
  ListingCategory,
  ListingStatus,
  UserAccount,
  VerificationRequest,
} from '@/lib/types';
import {
  ADMIN_ROLE_DESCRIPTIONS,
  CATEGORY_LABELS,
  calculateListingCompleteness,
  calculatePolygonMetrics,
  canAdminPerformAction,
  formatAreaValue,
  getAdminRolePermissions,
} from '@/lib/rules';
import { DataTable, DataColumn } from '@/components/shared/DataTable';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  ModerationActionType,
  ModerationControls,
} from '@/components/shared/ModerationControls';
import { MediatorDeskRedirectCard } from '@/components/workspaces/shared/MediatorDeskRedirectCard';
import type { MasterControlSubTab } from '@/components/workspaces/MasterControlConsole';
import { useAppConfig, useHub } from '@/components/providers/AppConfigProvider';
import {
  SuperadminNavShell,
  type SuperadminNavGroup,
} from '@/components/workspaces/superadmin/SuperadminNavShell';

const AdminSubTabSkeleton = () => (
  <div className="space-y-3 py-2">
    <div className="dd-shimmer h-24 w-full rounded-2xl border border-[var(--ps-border)]" />
    <div className="dd-shimmer h-64 w-full rounded-2xl border border-[var(--ps-border)]" />
  </div>
);

const CategoryDetailView = dynamic(
  () =>
    import('@/components/listings/CategoryDetailView').then(
      (m) => m.CategoryDetailView
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const AdminBulletinManager = dynamic(
  () =>
    import('@/components/workspaces/AdminBulletinManager').then(
      (m) => m.AdminBulletinManager
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const MasterControlConsole = dynamic(
  () =>
    import('@/components/workspaces/MasterControlConsole').then(
      (m) => m.MasterControlConsole
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const CivicDirectoryManager = dynamic(
  () =>
    import('@/components/workspaces/civic/CivicDirectoryManager').then(
      (m) => m.CivicDirectoryManager
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const SuperAdminSystemAuditSection = dynamic(
  () =>
    import('@/components/workspaces/SuperAdminPanel').then(
      (m) => m.SuperAdminSystemAuditSection
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const AuditLogsViewer = dynamic(
  () =>
    import('@/components/workspaces/superadmin/AuditLogsViewer').then(
      (m) => m.AuditLogsViewer
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const CategoryBuilder = dynamic(
  () =>
    import('@/components/workspaces/superadmin/CategoryBuilder').then(
      (m) => m.CategoryBuilder
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const CommandCenterOverview = dynamic(
  () =>
    import('@/components/workspaces/superadmin/CommandCenterOverview').then(
      (m) => m.CommandCenterOverview
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const HomepageBuilder = dynamic(
  () =>
    import('@/components/workspaces/superadmin/HomepageBuilder').then(
      (m) => m.HomepageBuilder
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const PaymentMethodsMatrix = dynamic(
  () =>
    import('@/components/workspaces/superadmin/PaymentMethodsMatrix').then(
      (m) => m.PaymentMethodsMatrix
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const SubscribersManager = dynamic(
  () =>
    import('@/components/workspaces/superadmin/SubscribersManager').then(
      (m) => m.SubscribersManager
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const SubscriptionPlansBuilder = dynamic(
  () =>
    import('@/components/workspaces/superadmin/SubscriptionPlansBuilder').then(
      (m) => m.SubscriptionPlansBuilder
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);
const PayPerMonetizationStudio = dynamic(
  () =>
    import('@/components/workspaces/superadmin/PayPerMonetizationStudio').then(
      (m) => m.PayPerMonetizationStudio
    ),
  { ssr: false, loading: AdminSubTabSkeleton }
);

interface AdminWorkspaceProps {
  onOpenListingOnMap: (listingId: string) => void;
}

type AdminTab =
  | 'command'
  | 'listings'
  | 'partner_applications'
  | 'bulletins'
  | 'moderation_civic'
  | 'escrow_disputes'
  | 'homepage_builder'
  | 'categories_icons'
  | 'subscription_plans'
  | 'pay_per_monetization'
  | 'payment_methods'
  | 'hubs_brand'
  | 'users_roles'
  | 'subscribers'
  | 'audit_logs'
  | 'data_import_export'
  | 'system_health';

const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Administrator',
  listing_moderator: 'Listing Moderator',
  verification_officer: 'Verification Officer',
  community_moderator: 'Community Moderator',
  customer_support: 'Customer Support',
  finance_admin: 'Finance/Commercial Administrator',
  analytics_viewer: 'Analytics Viewer',
};

// `super_admin` is immutable via client sessions and excluded from the promotion ladder
const ROLE_LADDER: GovernedUserRole[] = [
  'visitor',
  'staff',
  'owner',
  'admin',
];

const GOVERNED_ROLE_LABELS: Record<GovernedUserRole, string> = {
  visitor: 'Visitor',
  staff: 'Staff',
  owner: 'Owner',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

interface SuperAdminGovernanceSectionProps {
  baseUsers: UserAccount[];
  listingsCount: number;
  sampleListingsCount: number;
  canManageUsers: boolean;
  canManageSettings: boolean;
  showSampleData: boolean;
  onUpdateLocalUserRole: (
    userId: string,
    updates: Partial<Pick<UserAccount, 'roleType' | 'adminRole' | 'status'>>
  ) => void;
  onToggleSampleData: (enabled: boolean) => void;
  onNotice: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

function SuperAdminGovernanceSection({
  baseUsers,
  listingsCount,
  sampleListingsCount,
  canManageUsers,
  canManageSettings,
  showSampleData,
  onUpdateLocalUserRole,
  onToggleSampleData,
  onNotice,
}: SuperAdminGovernanceSectionProps) {
  const { confirm: confirmGov, dialog: govConfirmDialog } =
    useConfirmDialogState();
  const [liveAdminUsers, setLiveAdminUsers] = useState<UserAccount[]>([]);
  const [roleOverrides, setRoleOverrides] = useState<
    Record<string, GovernedUserRole>
  >({});
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [isUpdatingSetting, setIsUpdatingSetting] = useState(false);
  const [localShowSampleDataOverride, setLocalShowSampleDataOverride] =
    useState<boolean | null>(null);
  const effectiveShowSampleData =
    localShowSampleDataOverride ?? showSampleData;

  useEffect(() => {
    let active = true;
    fetchAllUsers()
      .then((fetchedUsers) => {
        if (!active || fetchedUsers.length === 0) return;
        setLiveAdminUsers(fetchedUsers);
      })
      .catch(() => {
        // Fallback to combined users
      });

    fetchAppSettings()
      .then((settings) => {
        if (!active) return;
        setLocalShowSampleDataOverride(settings.show_sample_data !== false);
      })
      .catch(() => {
        // Fallback to current setting
      });

    return () => {
      active = false;
    };
  }, []);

  const governedUsers = useMemo(() => {
    const merged = new Map<string, UserAccount>();
    for (const u of baseUsers) {
      if (u.id) merged.set(u.id, u);
    }
    for (const lu of liveAdminUsers) {
      if (lu.id) merged.set(lu.id, lu);
    }
    return Array.from(merged.values());
  }, [baseUsers, liveAdminUsers]);

  const resolveUserGovernedRole = useCallback(
    (u: UserAccount): GovernedUserRole => {
      if (roleOverrides[u.id]) return roleOverrides[u.id];
      const withRole = u as UserAccount & { role?: string };
      if (withRole.role) return normalizeGovernedRole(withRole.role);
      if (u.adminRole === 'super_admin') return 'super_admin';
      if (u.roleType === 'admin') return 'admin';
      if (u.roleType === 'owner') return 'owner';
      if (u.roleType === 'staff') return 'staff';
      return 'visitor';
    },
    [roleOverrides]
  );

  const handleChangeGovernedRole = useCallback(
    async (user: UserAccount, nextRole: GovernedUserRole) => {
      const current = resolveUserGovernedRole(user);
      if (current === 'super_admin' || nextRole === 'super_admin') {
        onNotice({
          type: 'error',
          text: 'Immutable Guardrail: super_admin accounts are read-only and cannot be granted or modified via client UI/API.',
        });
        return;
      }
      if (!canManageUsers) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can promote or demote user roles.',
        });
        return;
      }
      if (current === nextRole) return;

      const currentIdx = ROLE_LADDER.indexOf(current);
      const nextIdx = ROLE_LADDER.indexOf(nextRole);
      const isDemotion = currentIdx >= 0 && nextIdx >= 0 && nextIdx < currentIdx;

      const ok = await confirmGov({
        title: `${isDemotion ? 'Demote' : 'Update'} Platform Role for ${user.name}?`,
        description: `Change ${user.name}'s platform role from ${GOVERNED_ROLE_LABELS[current]} to ${GOVERNED_ROLE_LABELS[nextRole]}.`,
        caution: isDemotion
          ? 'Demoting this account immediately revokes elevated workspace permissions on next request.'
          : nextRole === 'admin'
            ? 'Granting Admin gives this user access to moderation and operational review tools.'
            : undefined,
        impactSummary: [
          `Account: ${user.name}${user.email ? ` (${user.email})` : ''}`,
          `Role transition: ${GOVERNED_ROLE_LABELS[current]} → ${GOVERNED_ROLE_LABELS[nextRole]}`,
        ],
        confirmLabel: isDemotion ? 'Confirm Demotion' : 'Confirm Role Change',
        variant: isDemotion ? 'danger' : 'warning',
      });
      if (!ok) return;

      setUpdatingUserId(user.id);
      setRoleOverrides((prev) => ({ ...prev, [user.id]: nextRole }));

      const mappedFields = mapGovernedRoleToAccountFields(nextRole);
      onUpdateLocalUserRole(user.id, mappedFields);

      const res = await updateUserRole(user.id, nextRole);
      setUpdatingUserId(null);

      if (res.ok) {
        onNotice({
          type: 'success',
          text: `Updated ${user.name}'s platform role to ${GOVERNED_ROLE_LABELS[nextRole]}.`,
        });
      } else {
        onNotice({
          type: 'error',
          text:
            res.error ||
            `Failed to update ${user.name}'s role in Supabase profiles.`,
        });
      }
    },
    [
      canManageUsers,
      confirmGov,
      onNotice,
      onUpdateLocalUserRole,
      resolveUserGovernedRole,
    ]
  );

  const handleToggleSampleDataSwitch = useCallback(
    async (nextVal: boolean) => {
      if (!canManageSettings) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can alter global platform settings.',
        });
        return;
      }

      const ok = await confirmGov({
        title: nextVal
          ? 'Show [SAMPLE] Demo Listings Publicly?'
          : 'Hide All [SAMPLE] Demo Listings?',
        description: nextVal
          ? `Makes ${sampleListingsCount} sample listing(s) visible across the public directory and discovery map.`
          : `Hides ${sampleListingsCount} sample listing(s) from public visitors and search results.`,
        caution:
          'Changes the global public.app_settings.show_sample_data flag immediately for all users.',
        impactSummary: [
          `Affected listings: ${sampleListingsCount} of ${listingsCount}`,
          `Target state: ${nextVal ? 'Visible (Demo Mode)' : 'Hidden (Production Clean)'}`,
        ],
        confirmLabel: nextVal ? 'Show Sample Data' : 'Hide Sample Data',
        variant: 'warning',
      });
      if (!ok) return;

      setIsUpdatingSetting(true);
      setLocalShowSampleDataOverride(nextVal);
      onToggleSampleData(nextVal);

      const res = await updateAppSetting('show_sample_data', nextVal);
      setIsUpdatingSetting(false);

      if (res.ok) {
        onNotice({
          type: 'success',
          text: nextVal
            ? 'Platform Setting Updated: [SAMPLE] demo listings are now visible on the public map.'
            : 'Platform Setting Updated: Hidden all [SAMPLE] demo listings from the public map.',
        });
      } else {
        onNotice({
          type: 'info',
          text: nextVal
            ? 'Applied locally: [SAMPLE] demo listings enabled (Supabase RLS sync pending).'
            : 'Applied locally: [SAMPLE] demo listings hidden from the public map.',
        });
      }
    },
    [
      canManageSettings,
      confirmGov,
      listingsCount,
      onNotice,
      onToggleSampleData,
      sampleListingsCount,
    ]
  );

  const governanceColumns = useMemo<DataColumn<UserAccount>[]>(
    () => [
      {
        id: 'user',
        header: 'Registered User',
        accessor: (u) => u.name,
        sortValue: (u) => u.name,
        render: (u) => (
          <div>
            <div className="font-semibold text-[var(--ps-text)]">{u.name}</div>
            <div className="text-xs text-[var(--ps-text-muted)]">
              {u.email || `ID: ${u.id}`}
            </div>
          </div>
        ),
      },
      {
        id: 'currentRole',
        header: 'Current Role',
        accessor: (u) => resolveUserGovernedRole(u),
        sortValue: (u) => resolveUserGovernedRole(u),
        render: (u) => {
          const role = resolveUserGovernedRole(u);
          return (
            <span
              data-testid={`governance-role-badge-${u.id}`}
              className="inline-flex items-center rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text)]"
            >
              {GOVERNED_ROLE_LABELS[role]}
            </span>
          );
        },
      },
      {
        id: 'roleSelector',
        header: 'Assign Role (Visitor → Staff → Owner → Admin)',
        accessor: (u) => resolveUserGovernedRole(u),
        render: (u) => {
          const currentRole = resolveUserGovernedRole(u);
          if (currentRole === 'super_admin') {
            return (
              <span
                data-testid={`governance-role-locked-${u.id}`}
                title="Managed via SQL migration only"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-700 dark:text-rose-300"
              >
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>Super Admin · Locked</span>
              </span>
            );
          }

          const ladderIdx = ROLE_LADDER.indexOf(currentRole);
          const canPromote = ladderIdx >= 0 && ladderIdx < ROLE_LADDER.length - 1;
          const canDemote = ladderIdx > 0;
          const isRowUpdating = updatingUserId === u.id;

          return (
            <div className="flex flex-wrap items-center gap-2">
              <CustomSelectModal
                testId={`governance-role-select-${u.id}`}
                value={currentRole}
                disabled={!canManageUsers || isRowUpdating}
                onChange={(nextVal) => {
                  const nextRole = nextVal as GovernedUserRole;
                  void handleChangeGovernedRole(u, nextRole);
                }}
                placeholder="Select role"
                className="w-36"
                options={[
                  { value: 'visitor', label: 'Visitor' },
                  { value: 'staff', label: 'Staff' },
                  { value: 'owner', label: 'Owner' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />

              <button
                type="button"
                data-testid={`governance-promote-btn-${u.id}`}
                disabled={!canManageUsers || !canPromote || isRowUpdating}
                onClick={() => {
                  if (!canPromote) return;
                  const nextRole = ROLE_LADDER[ladderIdx + 1];
                  void handleChangeGovernedRole(u, nextRole);
                }}
                className="min-h-[44px] rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300 cursor-pointer"
              >
                Promote ↑
              </button>

              <button
                type="button"
                data-testid={`governance-demote-btn-${u.id}`}
                disabled={!canManageUsers || !canDemote || isRowUpdating}
                onClick={() => {
                  if (!canDemote) return;
                  const nextRole = ROLE_LADDER[ladderIdx - 1];
                  void handleChangeGovernedRole(u, nextRole);
                }}
                className="min-h-[44px] rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-300 cursor-pointer"
              >
                Demote ↓
              </button>
            </div>
          );
        },
      },
      {
        id: 'joinedAt',
        header: 'Joined',
        accessor: (u) => u.joinedAt,
        align: 'right',
        render: (u) => (
          <span className="font-mono text-xs text-[var(--ps-text-muted)]">
            {u.joinedAt}
          </span>
        ),
      },
    ],
    [
      canManageUsers,
      handleChangeGovernedRole,
      resolveUserGovernedRole,
      updatingUserId,
    ]
  );

  return (
    <section
      data-testid="platform-governance-section"
      aria-label="Platform Governance & Access Control"
      className="space-y-5 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xs"
    >
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--ps-border)] pb-4 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300">
              Super Admin RLS Enforced
            </span>
            <span className="text-xs text-[var(--ps-text-muted)]">
              public.profiles &amp; public.app_settings
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-[var(--ps-text)]">
            Platform Governance &amp; Access Control
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Promote or demote registered users across Visitor, Staff, Owner, and Admin tiers, or toggle global platform settings protected by Row Level Security.
          </p>
        </div>

        {/* Platform Settings: show_sample_data Toggle Card */}
        <div
          data-testid="platform-settings-card"
          className="flex items-center justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-3"
        >
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)]">
              Platform Settings — Sample Data Visibility
            </div>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              Toggle <code className="font-mono">show_sample_data</code> ({sampleListingsCount} of {listingsCount} listings marked <span className="font-mono">[SAMPLE]</span>).
            </p>
          </div>
          <label
            htmlFor="show-sample-data-checkbox"
            className="inline-flex cursor-pointer items-center gap-2.5"
          >
            <input
              id="show-sample-data-checkbox"
              type="checkbox"
              role="switch"
              data-testid="show-sample-data-toggle"
              aria-checked={effectiveShowSampleData}
              disabled={!canManageSettings || isUpdatingSetting}
              checked={effectiveShowSampleData}
              onChange={(e) => {
                void handleToggleSampleDataSwitch(e.target.checked);
              }}
              className="h-4 w-4 rounded border-[var(--ps-border)] accent-[var(--ps-accent)] disabled:cursor-not-allowed"
            />
            <span className="text-xs font-bold text-[var(--ps-text)]">
              {effectiveShowSampleData ? 'Showing [SAMPLE]' : 'Hidden [SAMPLE]'}
            </span>
          </label>
        </div>
      </div>

      <DataTable
        title={`Registered Users & Role Governance (${governedUsers.length})`}
        subtitle="Select a target role or click Promote / Demote (Visitor → Staff → Owner → Admin) to update public.profiles. Super Admin accounts are immutable via client UI."
        data={governedUsers}
        columns={governanceColumns}
        rowKey={(u) => u.id}
        searchPlaceholder="Search users by name, email, or role..."
        exportFilename="printswift-governance-users"
      />
      {govConfirmDialog}
    </section>
  );
}

interface LocalizationManagerSectionProps {
  canManageTranslations: boolean;
  onNotice: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

function LocalizationManagerSection({
  canManageTranslations,
  onNotice,
}: LocalizationManagerSectionProps) {
  const [entries, setEntries] = useState<TranslationMatrixEntry[]>([]);
  const [draftValues, setDraftValues] = useState<
    Record<string, Record<SupportedLocale, string>>
  >({});
  const [dataSource, setDataSource] = useState<'supabase' | 'fallback'>(
    'fallback'
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);

  const [newNamespace, setNewNamespace] = useState<string>('Settings');
  const [newKey, setNewKey] = useState<string>('');
  const [newEnValue, setNewEnValue] = useState<string>('');
  const [newPaiteValue, setNewPaiteValue] = useState<string>('');
  const [newMniValue, setNewMniValue] = useState<string>('');
  const [isAddingKey, setIsAddingKey] = useState<boolean>(false);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchAllTranslationEntries();
    setEntries(result.entries);
    setDataSource(result.source);
    const initialDrafts: Record<string, Record<SupportedLocale, string>> = {};
    for (const item of result.entries) {
      initialDrafts[item.id] = {
        en: item.values.en || '',
        paite: item.values.paite || '',
        mni: item.values.mni || '',
      };
    }
    setDraftValues(initialDrafts);
    setIsLoading(false);
    if (result.error) {
      onNotice({
        type: 'info',
        text: `Loaded static i18n fallback (${result.error}).`,
      });
    }
  }, [onNotice]);

  useEffect(() => {
    let active = true;
    fetchAllTranslationEntries()
      .then((result) => {
        if (!active) return;
        setEntries(result.entries);
        setDataSource(result.source);
        const initialDrafts: Record<
          string,
          Record<SupportedLocale, string>
        > = {};
        for (const item of result.entries) {
          initialDrafts[item.id] = {
            en: item.values.en || '',
            paite: item.values.paite || '',
            mni: item.values.mni || '',
          };
        }
        setDraftValues(initialDrafts);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDraftChange = useCallback(
    (rowId: string, locale: SupportedLocale, value: string) => {
      setDraftValues((prev) => ({
        ...prev,
        [rowId]: {
          en: prev[rowId]?.en ?? '',
          paite: prev[rowId]?.paite ?? '',
          mni: prev[rowId]?.mni ?? '',
          [locale]: value,
        },
      }));
    },
    []
  );

  const handleSaveRow = useCallback(
    async (entry: TranslationMatrixEntry) => {
      if (!canManageTranslations) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can update translations.',
        });
        return;
      }

      const values = draftValues[entry.id] || entry.values;
      setSavingRowId(entry.id);
      const res = await upsertTranslationKeyGroup({
        namespace: entry.namespace,
        key: entry.key,
        values: {
          en: values.en ?? '',
          paite: values.paite ?? '',
          mni: values.mni ?? '',
        },
      });
      setSavingRowId(null);

      if (res.ok) {
        setEntries((prev) =>
          prev.map((row) =>
            row.id === entry.id
              ? {
                  ...row,
                  values: { ...values },
                  source: 'supabase',
                  updatedAt: new Date().toISOString(),
                }
              : row
          )
        );
        onNotice({
          type: 'success',
          text: `Saved over-the-air translations for "${entry.namespace}.${entry.key}" across English, Paite, and Meitei.`,
        });
      } else {
        onNotice({
          type: 'error',
          text:
            res.error ||
            `Failed to persist "${entry.namespace}.${entry.key}" to Supabase translations.`,
        });
      }
    },
    [canManageTranslations, draftValues, onNotice]
  );

  const handleDeleteRow = useCallback(
    async (entry: TranslationMatrixEntry) => {
      if (!canManageTranslations) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can delete translation keys.',
        });
        return;
      }

      setDeletingRowId(entry.id);
      const res = await deleteTranslationKeyGroup(entry.namespace, entry.key);
      setDeletingRowId(null);

      if (res.ok) {
        setEntries((prev) => prev.filter((row) => row.id !== entry.id));
        onNotice({
          type: 'info',
          text: `Removed translation key "${entry.namespace}.${entry.key}" from Supabase.`,
        });
      } else {
        onNotice({
          type: 'error',
          text:
            res.error ||
            `Failed to delete "${entry.namespace}.${entry.key}" from Supabase.`,
        });
      }
    },
    [canManageTranslations, onNotice]
  );

  const handleAddKey = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canManageTranslations) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can add new translation keys.',
        });
        return;
      }

      const ns = newNamespace.trim();
      const k = newKey.trim();
      if (!ns || !k) {
        onNotice({
          type: 'error',
          text: 'Please provide both a Namespace and Key name.',
        });
        return;
      }

      const values: Record<SupportedLocale, string> = {
        en: newEnValue.trim() || k,
        paite: newPaiteValue.trim() || newEnValue.trim() || k,
        mni: newMniValue.trim() || newEnValue.trim() || k,
      };

      setIsAddingKey(true);
      const res = await upsertTranslationKeyGroup({
        namespace: ns,
        key: k,
        values,
      });
      setIsAddingKey(false);

      if (res.ok) {
        const rowId = `${ns}::${k}`;
        const nextEntry: TranslationMatrixEntry = {
          id: rowId,
          namespace: ns,
          key: k,
          values,
          updatedAt: new Date().toISOString(),
          source: 'supabase',
        };
        setEntries((prev) => {
          const filtered = prev.filter((item) => item.id !== rowId);
          return [nextEntry, ...filtered];
        });
        setDraftValues((prev) => ({
          ...prev,
          [rowId]: values,
        }));
        setNewKey('');
        setNewEnValue('');
        setNewPaiteValue('');
        setNewMniValue('');
        onNotice({
          type: 'success',
          text: `Added translation key "${ns}.${k}" over-the-air.`,
        });
      } else {
        onNotice({
          type: 'error',
          text: res.error || `Failed to insert "${ns}.${k}" into Supabase.`,
        });
      }
    },
    [
      canManageTranslations,
      newEnValue,
      newKey,
      newMniValue,
      newNamespace,
      newPaiteValue,
      onNotice,
    ]
  );

  const translationColumns = useMemo<DataColumn<TranslationMatrixEntry>[]>(
    () => [
      {
        id: 'key',
        header: 'Namespace & Key',
        accessor: (row) => `${row.namespace}.${row.key}`,
        sortValue: (row) => `${row.namespace}.${row.key}`,
        render: (row) => (
          <div className="min-w-[160px]">
            <span className="inline-block rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[var(--ps-accent)]">
              {row.namespace}
            </span>
            <div className="mt-1 font-mono text-xs font-bold text-[var(--ps-text)]">
              {row.key}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ps-text-muted)]">
              Source: {row.source}
            </div>
          </div>
        ),
      },
      {
        id: 'en',
        header: 'English (en)',
        accessor: (row) => draftValues[row.id]?.en ?? row.values.en,
        exportValue: (row) => draftValues[row.id]?.en ?? row.values.en,
        render: (row) => (
          <input
            type="text"
            aria-label={`English translation for ${row.namespace}.${row.key}`}
            data-testid={`i18n-input-en-${row.namespace}-${row.key}`}
            disabled={!canManageTranslations}
            value={draftValues[row.id]?.en ?? row.values.en}
            onChange={(e) => handleDraftChange(row.id, 'en', e.target.value)}
            className="w-full min-w-[180px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
          />
        ),
      },
      {
        id: 'paite',
        header: 'Paite (paite)',
        accessor: (row) => draftValues[row.id]?.paite ?? row.values.paite,
        exportValue: (row) => draftValues[row.id]?.paite ?? row.values.paite,
        render: (row) => (
          <input
            type="text"
            aria-label={`Paite translation for ${row.namespace}.${row.key}`}
            data-testid={`i18n-input-paite-${row.namespace}-${row.key}`}
            disabled={!canManageTranslations}
            value={draftValues[row.id]?.paite ?? row.values.paite}
            onChange={(e) =>
              handleDraftChange(row.id, 'paite', e.target.value)
            }
            className="w-full min-w-[180px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
          />
        ),
      },
      {
        id: 'mni',
        header: 'Meitei / Manipuri (mni)',
        accessor: (row) => draftValues[row.id]?.mni ?? row.values.mni,
        exportValue: (row) => draftValues[row.id]?.mni ?? row.values.mni,
        render: (row) => (
          <input
            type="text"
            aria-label={`Meitei translation for ${row.namespace}.${row.key}`}
            data-testid={`i18n-input-mni-${row.namespace}-${row.key}`}
            disabled={!canManageTranslations}
            value={draftValues[row.id]?.mni ?? row.values.mni}
            onChange={(e) => handleDraftChange(row.id, 'mni', e.target.value)}
            className="w-full min-w-[180px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
          />
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        accessor: (row) => row.id,
        align: 'right',
        render: (row) => {
          const isSaving = savingRowId === row.id;
          const isDeleting = deletingRowId === row.id;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                data-testid={`i18n-save-btn-${row.namespace}-${row.key}`}
                disabled={!canManageTranslations || isSaving || isDeleting}
                onClick={() => void handleSaveRow(row)}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-accent-fg)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>Save</span>
              </button>
              <button
                type="button"
                data-testid={`i18n-delete-btn-${row.namespace}-${row.key}`}
                aria-label={`Delete ${row.namespace}.${row.key}`}
                disabled={!canManageTranslations || isSaving || isDeleting}
                onClick={() => void handleDeleteRow(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          );
        },
      },
    ],
    [
      canManageTranslations,
      deletingRowId,
      draftValues,
      handleDeleteRow,
      handleDraftChange,
      handleSaveRow,
      savingRowId,
    ]
  );

  return (
    <div
      data-testid="localization-manager-section"
      className="space-y-6"
    >
      {/* Header & Over-The-Air Status */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xs">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--ps-border)] pb-4 md:flex-row md:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                Super Admin Over-The-Air i18n
              </span>
              <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ps-text-muted)]">
                public.translations ({dataSource === 'supabase' ? 'Live Supabase' : 'Local Fallback'})
              </span>
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--ps-text)]">
              Localization Manager — English, Paite &amp; Meitei
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Edit UI copy or add new translation keys over the air without redeploying code. Changes persist directly to Supabase <code className="font-mono">public.translations</code> (Super Admin RLS enforced) with automatic local JSON fallback.
            </p>
          </div>

          <button
            type="button"
            data-testid="i18n-refresh-btn"
            disabled={isLoading}
            onClick={() => void loadEntries()}
            className="inline-flex min-h-[40px] items-center gap-2 self-start rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] disabled:opacity-55"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[var(--ps-accent)] ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Sync from Supabase</span>
          </button>
        </div>

        {/* Add New Translation Key Form */}
        <form
          onSubmit={(e) => void handleAddKey(e)}
          className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-6 md:items-end"
        >
          <div>
            <label
              htmlFor="i18n-new-namespace"
              className="block text-[11px] font-semibold text-[var(--ps-text-muted)]"
            >
              Namespace
            </label>
            <input
              id="i18n-new-namespace"
              data-testid="i18n-new-namespace"
              type="text"
              required
              disabled={!canManageTranslations || isAddingKey}
              value={newNamespace}
              onChange={(e) => setNewNamespace(e.target.value)}
              placeholder="e.g., Settings"
              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
          </div>

          <div>
            <label
              htmlFor="i18n-new-key"
              className="block text-[11px] font-semibold text-[var(--ps-text-muted)]"
            >
              Translation Key
            </label>
            <input
              id="i18n-new-key"
              data-testid="i18n-new-key"
              type="text"
              required
              disabled={!canManageTranslations || isAddingKey}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g., welcomeBanner"
              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
          </div>

          <div>
            <label
              htmlFor="i18n-new-en"
              className="block text-[11px] font-semibold text-[var(--ps-text-muted)]"
            >
              English (en)
            </label>
            <input
              id="i18n-new-en"
              data-testid="i18n-new-en"
              type="text"
              required
              disabled={!canManageTranslations || isAddingKey}
              value={newEnValue}
              onChange={(e) => setNewEnValue(e.target.value)}
              placeholder="English string"
              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
          </div>

          <div>
            <label
              htmlFor="i18n-new-paite"
              className="block text-[11px] font-semibold text-[var(--ps-text-muted)]"
            >
              Paite (paite)
            </label>
            <input
              id="i18n-new-paite"
              data-testid="i18n-new-paite"
              type="text"
              disabled={!canManageTranslations || isAddingKey}
              value={newPaiteValue}
              onChange={(e) => setNewPaiteValue(e.target.value)}
              placeholder="Paite string"
              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
          </div>

          <div>
            <label
              htmlFor="i18n-new-mni"
              className="block text-[11px] font-semibold text-[var(--ps-text-muted)]"
            >
              Meitei (mni)
            </label>
            <input
              id="i18n-new-mni"
              data-testid="i18n-new-mni"
              type="text"
              disabled={!canManageTranslations || isAddingKey}
              value={newMniValue}
              onChange={(e) => setNewMniValue(e.target.value)}
              placeholder="Meitei string"
              className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
          </div>

          <button
            type="submit"
            data-testid="i18n-add-key-btn"
            disabled={!canManageTranslations || isAddingKey}
            className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAddingKey ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span>Add Key</span>
          </button>
        </form>
      </section>

      <DataTable
        title={`Over-The-Air Translation Dictionary (${entries.length})`}
        subtitle="Edit any English, Paite, or Meitei string inline and click Save to push instant updates to Supabase."
        data={entries}
        columns={translationColumns}
        rowKey={(row) => row.id}
        searchPlaceholder="Search namespace, key, or translated text..."
        exportFilename="printswift-i18n-translations"
        emptyMessage={
          isLoading
            ? 'Loading translations from Supabase...'
            : 'No translation entries found.'
        }
      />
    </div>
  );
}

export default function AdminWorkspace({
  onOpenListingOnMap,
}: AdminWorkspaceProps) {
  const {
    currentUser,
    users,
    updateUserRoleOrStatus,
    listings,
    areaUnit,
    changeListingStatus,
    bulkUpdateListingStatus,
    importListingsBatch,
    updateListingCoordinates,
    verificationRequests,
    decideVerificationRequest,
    moderationCases,
    decideModerationCase,
    dynamicFields,
    saveDynamicField,
    deleteDynamicField,
    platformSettings,
    updatePlatformSettings,
  } = useAppStore();
  const {
    user: authUser,
    role: syncedAuthRole,
    fullName: syncedFullName,
  } = useAuth();
  const { paymentConfig, operations } = useAppConfig();
  const { hubs, activeHub } = useHub();
  const paymentModeChipLabel =
    paymentConfig.payment_mode === 'dual'
      ? 'Razorpay + Manual'
      : paymentConfig.payment_mode === 'razorpay_only'
        ? 'Razorpay Only'
        : 'Manual Only';
  const productionModeChipLabel = operations.hide_sample_data
    ? 'Live Production'
    : 'Showing [SAMPLE]';
  const adminGreetingName =
    syncedFullName ||
    (authUser?.user_metadata?.full_name as string | undefined) ||
    currentUser.name ||
    'Administrator';
  const adminRoleDisplay = authUser
    ? syncedAuthRole
    : currentUser.adminRole || currentUser.roleType || 'super_admin';

  const [actualDbRole, setActualDbRole] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured() || !authUser?.id) return;
    supabase
      .from('profiles')
      .select('role')
      .eq('id', authUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const raw = String(
          (data as { role?: string | null } | null)?.role || ''
        )
          .trim()
          .toLowerCase();
        if (raw) setActualDbRole(raw);
      });
    return () => {
      active = false;
    };
  }, [authUser?.id]);

  const isSuperAdminExclusive =
    String(adminRoleDisplay || '').toLowerCase() === 'super_admin' ||
    actualDbRole === 'super_admin';

  const [activeTab, setActiveTab] = useState<AdminTab>('command');
  const [moderationSubView, setModerationSubView] = useState<
    'verification' | 'moderation' | 'civic'
  >('verification');
  const [escrowSubView, setEscrowSubView] = useState<
    'pick_n_drop' | 'payments_queue' | 'print_settlements'
  >('pick_n_drop');
  const [listingsSubView, setListingsSubView] = useState<'master' | 'reviews'>(
    'master'
  );
  const [homepageSubView, setHomepageSubView] = useState<
    'builder' | 'banners' | 'featured'
  >('builder');
  const [plansSubView, setPlansSubView] = useState<'builder' | 'rates_promos'>(
    'builder'
  );
  const [paymentMethodsSubView, setPaymentMethodsSubView] = useState<
    'matrix' | 'gateway'
  >('matrix');
  const [subscribersSubView, setSubscribersSubView] = useState<
    'subscribers' | 'referrals'
  >('subscribers');
  const [hubsBrandSubView, setHubsBrandSubView] =
    useState<MasterControlSubTab>('hubs_rates');
  const [systemSubView, setSystemSubView] = useState<
    'health' | 'media' | 'localization' | 'geographic' | 'settings'
  >('health');
  const [adminNotice, setAdminNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Sync deep-link ?tab= query param on mount (preserves UniversalAppSearch shortcuts)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawTab = new URLSearchParams(window.location.search)
      .get('tab')
      ?.trim()
      .toLowerCase();
    if (!rawTab) return;
    queueMicrotask(() => {
      if (rawTab === 'plans' || rawTab === 'rates_plans') {
        setActiveTab('subscription_plans');
      } else if (
        rawTab === 'custody' ||
        rawTab === 'escrow' ||
        rawTab === 'payments_queue'
      ) {
        setActiveTab('escrow_disputes');
        setEscrowSubView(
          rawTab === 'payments_queue' ? 'payments_queue' : 'pick_n_drop'
        );
      } else if (rawTab === 'media' || rawTab === 'system_audit') {
        setActiveTab('system_health');
        setSystemSubView(rawTab === 'media' ? 'media' : 'health');
      } else if (rawTab === 'brand') {
        setActiveTab('hubs_brand');
        setHubsBrandSubView('brand_legal');
      } else if (rawTab === 'audit' || rawTab === 'audit_logs') {
        setActiveTab('audit_logs');
      } else if (rawTab === 'users' || rawTab === 'users_roles') {
        setActiveTab('users_roles');
      } else if (rawTab === 'categories' || rawTab === 'categories_icons') {
        setActiveTab('categories_icons');
      } else if (rawTab === 'homepage' || rawTab === 'homepage_builder') {
        setActiveTab('homepage_builder');
      } else if (rawTab === 'payments' || rawTab === 'payment_methods') {
        setActiveTab('payment_methods');
      } else if (rawTab === 'pay_per' || rawTab === 'pay_per_monetization') {
        setActiveTab('pay_per_monetization');
      }
    });
  }, []);

  const [previewListing, setPreviewListing] = useState<Listing | null>(null);
  const { confirm: confirmModeration, dialog: moderationConfirmDialog } =
    useConfirmDialogState();
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {}
  );
  const [modSearch, setModSearch] = useState('');
  const [modStatusFilter, setModStatusFilter] = useState<
    'all' | 'open' | 'resolved_kept' | 'resolved_actioned'
  >('all');
  const [remotePendingListings, setRemotePendingListings] = useState<Listing[]>(
    []
  );
  const [remoteUsers, setRemoteUsers] = useState<UserAccount[]>([]);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [pendingCsvImport, setPendingCsvImport] = useState<{
    fileName: string;
    validListings: Listing[];
    errors: Array<{ row?: number; message: string }>;
  } | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch listings and profiles from Supabase to populate the Admin Verification Queue & User Management Table
  useEffect(() => {
    let active = true;
    fetchListings()
      .then((rows) => {
        if (!active) return;
        setRemotePendingListings(rows);
      })
      .catch(() => {
        // Fallback to local state when Supabase is unconfigured
      });

    if (isSupabaseConfigured()) {
      supabase
        .from('listings')
        .select('*')
        .eq('status', 'pending')
        .order('updated_at', { ascending: false })
        .then(({ data, error }) => {
          if (!active || error || !Array.isArray(data) || data.length === 0) {
            return;
          }
          const pendingRows: Listing[] = data.map(
            (row: Record<string, unknown>) => ({
              id: String(row.id || ''),
              title: String(row.title || 'Pending Listing'),
              category: String(row.category || 'business') as ListingCategory,
              subcategory: String(row.subcategory || 'General'),
              status: 'pending' as ListingStatus,
              verificationStatus: 'pending_review',
              description: String(row.description || ''),
              shortDescription: String(row.short_description || ''),
              locality: String(row.locality || 'Churachandpur'),
              address: String(row.address || 'Churachandpur'),
              coordinates: (row.coordinates as { lat: number; lng: number }) || {
                lat: 24.3335,
                lng: 93.6978,
              },
              contactPhone: String(row.contact_phone || ''),
              contactEmail: String(row.contact_email || ''),
              coverImage: String(row.cover_image || ''),
              galleryImages: Array.isArray(row.gallery_images)
                ? (row.gallery_images as string[])
                : [],
              ownerId: String(row.owner_id || ''),
              ownerName: String(row.owner_name || 'Listing Owner'),
              assignedStaffIds: [],
              createdAt: String(row.created_at || new Date().toISOString()),
              updatedAt: String(row.updated_at || new Date().toISOString()),
              isFeaturedDemo: false,
              rating: Number(row.rating || 0),
              reviewCount: Number(row.review_count || 0),
              viewsCount: Number(row.views_count || 0),
              mapImpressionsCount: Number(row.map_impressions_count || 0),
              detailVisitsCount: Number(row.detail_visits_count || 0),
              directionClicksCount: Number(row.direction_clicks_count || 0),
              followsCount: Number(row.follows_count || 0),
              enquiriesCount: Number(row.enquiries_count || 0),
              versionHistory: [],
            })
          );
          setRemotePendingListings((prev) => {
            const seen = new Set(prev.map((item) => item.id));
            return [
              ...pendingRows.filter((item) => !seen.has(item.id)),
              ...prev,
            ];
          });
        });
    }

    if (isSupabaseConfigured()) {
      supabase
        .from('profiles')
        .select('*')
        .then(({ data, error }) => {
          if (!active || error || !Array.isArray(data)) return;
          const mappedUsers: UserAccount[] = data.map(
            (row: Record<string, unknown>) => {
              const nameStr = String(
                row.full_name || row.name || row.email || 'Directory User'
              );
              const roleRaw = String(row.role_type || row.role || 'visitor');
              const roleType: UserAccount['roleType'] =
                roleRaw === 'admin' ||
                roleRaw === 'owner' ||
                roleRaw === 'staff'
                  ? roleRaw
                  : 'visitor';
              return {
                id: String(row.id || ''),
                name: nameStr,
                email: String(row.email || ''),
                roleType,
                adminRole: row.admin_role
                  ? (String(row.admin_role) as AdminRole)
                  : undefined,
                status:
                  row.status === 'suspended' ? 'suspended' : 'active',
                joinedAt: row.created_at
                  ? String(row.created_at).slice(0, 10)
                  : new Date().toISOString().slice(0, 10),
                avatarLabel: nameStr.slice(0, 2).toUpperCase(),
                description: String(row.description || 'Registered User'),
              };
            }
          );
          setRemoteUsers(mappedUsers);
        });
    }

    return () => {
      active = false;
    };
  }, []);

  const combinedUsers = useMemo(() => {
    const map = new Map<string, UserAccount>();
    for (const u of users) {
      map.set(u.id, u);
    }
    for (const ru of remoteUsers) {
      if (ru.id && !map.has(ru.id)) {
        map.set(ru.id, ru);
      }
    }
    return Array.from(map.values());
  }, [users, remoteUsers]);

  const combinedListings = useMemo(() => {
    const mergedMap = new Map<string, Listing>();
    for (const item of listings) {
      mergedMap.set(item.id, item);
    }
    for (const remoteItem of remotePendingListings) {
      if (!mergedMap.has(remoteItem.id)) {
        mergedMap.set(remoteItem.id, remoteItem);
      }
    }
    return Array.from(mergedMap.values());
  }, [listings, remotePendingListings]);

  const handleExportCsv = useCallback(() => {
    exportListingsToCsv(combinedListings, 'printswift-listings-export.csv');
    setAdminNotice({
      type: 'success',
      text: `Exported ${combinedListings.length} listing(s) to printswift-listings-export.csv.`,
    });
  }, [combinedListings]);

  const handleBulkImportCsvChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImportingCsv(true);
      setAdminNotice({
        type: 'info',
        text: `Parsing and validating "${file.name}" for preview…`,
      });

      try {
        const ownerId = currentUser.id || 'admin-bulk-import';
        const ownerName = currentUser.name || 'Administrator';
        const parsed = await parseListingsCsvFile(file, {
          defaultOwnerId: ownerId,
          defaultOwnerName: ownerName,
        });

        setPendingCsvImport({
          fileName: file.name,
          validListings: parsed.validListings,
          errors: parsed.errors,
        });
        setActiveTab('data_import_export');

        if (parsed.validListings.length === 0) {
          const errSummary =
            parsed.errors.map((err) => err.message).join(' ') ||
            'No valid rows found. Ensure required columns (title, category_id, address) are present.';
          setAdminNotice({
            type: 'error',
            text: `CSV preview found 0 valid rows: ${errSummary}`,
          });
        } else {
          setAdminNotice({
            type: 'info',
            text: `Preview ready for "${file.name}": ${parsed.validListings.length} valid row(s), ${parsed.errors.length} validation warning(s). Review below before writing to Supabase.`,
          });
        }
      } catch (err) {
        setPendingCsvImport(null);
        setAdminNotice({
          type: 'error',
          text: `CSV parse failed: ${err instanceof Error ? err.message : 'Unable to parse CSV file.'}`,
        });
      } finally {
        setIsImportingCsv(false);
        if (csvFileInputRef.current) {
          csvFileInputRef.current.value = '';
        }
      }
    },
    [currentUser.id, currentUser.name]
  );

  const handleConfirmBulkCsvImport = useCallback(async () => {
    if (!pendingCsvImport || pendingCsvImport.validListings.length === 0) {
      return;
    }

    const ok = await confirmModeration({
      title: `Import ${pendingCsvImport.validListings.length} Listing(s) into Supabase?`,
      description: `Write ${pendingCsvImport.validListings.length} validated row(s) from "${pendingCsvImport.fileName}" directly into public.listings.`,
      caution:
        pendingCsvImport.errors.length > 0
          ? `${pendingCsvImport.errors.length} invalid row(s) will be skipped. Verify the preview rows before committing.`
          : 'This action creates new listing records in Supabase immediately.',
      impactSummary: [
        `File: ${pendingCsvImport.fileName}`,
        `Valid rows to write: ${pendingCsvImport.validListings.length}`,
        `Validation errors skipped: ${pendingCsvImport.errors.length}`,
      ],
      confirmLabel: `Import ${pendingCsvImport.validListings.length} Row(s)`,
      variant: 'warning',
    });
    if (!ok) return;

    const ownerId = currentUser.id || 'admin-bulk-import';
    setIsImportingCsv(true);
    setAppStatus('saving', 'Importing validated CSV listings…');

    try {
      const createdListings: Listing[] = [];
      const failedMessages: string[] = [];

      for (const item of pendingCsvImport.validListings) {
        try {
          const saved = await createListing(item, item.ownerId || ownerId);
          createdListings.push(saved);
        } catch (err) {
          failedMessages.push(
            `"${item.title}": ${err instanceof Error ? err.message : 'Insert error'}`
          );
        }
      }

      if (createdListings.length > 0) {
        setRemotePendingListings((prev) => [...createdListings, ...prev]);
        importListingsBatch(createdListings);
      }

      const validationWarning =
        pendingCsvImport.errors.length > 0
          ? ` (${pendingCsvImport.errors.length} invalid row(s) skipped)`
          : '';
      const failureWarning =
        failedMessages.length > 0
          ? ` (${failedMessages.length} failed: ${failedMessages.slice(0, 2).join('; ')})`
          : '';

      const succeeded = createdListings.length > 0;
      setAppStatus(succeeded ? 'success' : 'error');
      setAdminNotice({
        type: succeeded ? 'success' : 'error',
        text: succeeded
          ? `Bulk imported ${createdListings.length} listing(s) from "${pendingCsvImport.fileName}".${validationWarning}${failureWarning}`
          : `Failed to import listings from "${pendingCsvImport.fileName}".${validationWarning}${failureWarning}`,
      });
      if (succeeded) {
        setPendingCsvImport(null);
      }
    } finally {
      setIsImportingCsv(false);
    }
  }, [
    confirmModeration,
    currentUser.id,
    importListingsBatch,
    pendingCsvImport,
  ]);

  // Least-Privilege Role Capability Flags for the Active Admin Role (Task 4)
  const canManageUsers = canAdminPerformAction(currentUser, 'manage_users');
  const canManageListings = canAdminPerformAction(currentUser, 'manage_listings');
  const canManageVerification = canAdminPerformAction(
    currentUser,
    'manage_verification'
  );
  const canManageModeration = canAdminPerformAction(
    currentUser,
    'manage_moderation'
  );
  const canManageGeography = canAdminPerformAction(
    currentUser,
    'manage_geography'
  );
  const canManageSchema = canAdminPerformAction(currentUser, 'manage_schema');
  const canManageSettings = canAdminPerformAction(
    currentUser,
    'manage_settings'
  );
  const activeRolePermissions = getAdminRolePermissions(currentUser.adminRole);

  // Geographic Pin Editor State
  const [editingGeoListingId, setEditingGeoListingId] = useState<string>(
    () => listings[0]?.id || ''
  );
  const selectedGeoListing = useMemo(
    () =>
      listings.find((l) => l.id === editingGeoListingId) || listings[0] || null,
    [listings, editingGeoListingId]
  );
  const [geoLatInput, setGeoLatInput] = useState<string>(
    String(selectedGeoListing?.coordinates.lat || 24.3335)
  );
  const [geoLngInput, setGeoLngInput] = useState<string>(
    String(selectedGeoListing?.coordinates.lng || 93.6978)
  );
  const [geoLocalityInput, setGeoLocalityInput] = useState<string>(
    selectedGeoListing?.locality || 'New Lamka'
  );

  // Dynamic Field Modal State
  const [isDynamicFieldModalOpen, setIsDynamicFieldModalOpen] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldCategory, setNewFieldCategory] =
    useState<ListingCategory>('business');
  const [newFieldType, setNewFieldType] =
    useState<DynamicFieldDefinition['fieldType']>('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);

  // Command Centre Analytics
  const commandMetrics = useMemo(() => {
    const byCategory: Record<ListingCategory, number> = {
      business: 0,
      public_place: 0,
      service: 0,
      real_estate: 0,
      sports: 0,
    };
    const byStatus: Record<ListingStatus, number> = {
      draft: 0,
      submitted: 0,
      pending_verification: 0,
      changes_requested: 0,
      rejected: 0,
      published: 0,
      suspended: 0,
      archived: 0,
      expired: 0,
    };

    listings.forEach((l) => {
      byCategory[l.category] = (byCategory[l.category] || 0) + 1;
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    });

    const pendingVerifications = verificationRequests.filter(
      (v) => v.status === 'pending' || v.status === 'more_info_requested'
    ).length;
    const openModeration = moderationCases.filter(
      (m) => m.status === 'open'
    ).length;

    const incompleteListings = listings.filter(
      (l) => calculateListingCompleteness(l).score < 80
    );

    return {
      byCategory,
      byStatus,
      pendingVerifications,
      openModeration,
      incompleteListings,
    };
  }, [listings, verificationRequests, moderationCases]);

  // Phase 4-B: Listings requiring moderation/verification (status === 'pending', 'pending_verification', or 'submitted')
  const verificationQueueListings = useMemo(() => {
    const mergedMap = new Map<string, Listing>();
    for (const item of listings) {
      mergedMap.set(item.id, item);
    }
    for (const remoteItem of remotePendingListings) {
      if (!mergedMap.has(remoteItem.id)) {
        mergedMap.set(remoteItem.id, remoteItem);
      }
    }
    return Array.from(mergedMap.values()).filter((l) => {
      const statusStr = String(l.status);
      return (
        statusStr === 'pending' ||
        l.status === 'pending_verification' ||
        l.status === 'submitted'
      );
    });
  }, [listings, remotePendingListings]);

  const handleModerateListing = useCallback(
    async (
      listingId: string,
      targetStatus: ListingStatus,
      action: ModerationActionType
    ) => {
      if (!canManageVerification && !canManageListings) {
        setAdminNotice({
          type: 'error',
          text: `Permission denied: Role "${currentUser.adminRole}" cannot moderate listings.`,
        });
        return;
      }

      const targetListing = verificationQueueListings.find(
        (l) => l.id === listingId
      );
      const actionMap: Record<
        ModerationActionType,
        'approve' | 'reject' | 'request_changes'
      > = {
        Approve: 'approve',
        Reject: 'reject',
        'Request Changes': 'request_changes',
      };
      const mappedReviewAction = actionMap[action] || 'approve';
      const trimmedDecisionNote = (decisionNotes[listingId] || '').trim();

      if (
        (mappedReviewAction === 'reject' ||
          mappedReviewAction === 'request_changes') &&
        trimmedDecisionNote.length < 4
      ) {
        setAdminNotice({
          type: 'error',
          text: `Please enter a reviewer reason note (at least 4 characters) before clicking "${action}" on "${targetListing?.title || 'this listing'}".`,
        });
        return;
      }

      const confirmed = await confirmModeration({
        title:
          mappedReviewAction === 'approve'
            ? `Approve & Publish "${targetListing?.title || 'Listing'}"?`
            : mappedReviewAction === 'reject'
              ? `Reject "${targetListing?.title || 'Listing'}" & Purge Pending Media?`
              : `Request Changes for "${targetListing?.title || 'Listing'}"?`,
        description:
          mappedReviewAction === 'approve'
            ? 'Approving sets the listing verified & published and promotes its pending 14-day media into permanent storage.'
            : mappedReviewAction === 'reject'
              ? 'Rejecting hard-deletes unapproved uploaded files from Supabase Storage & media_assets, scrubs URLs, and notifies the owner.'
              : 'Moves listing back to changes_requested and notifies the owner with your required correction note.',
        caution:
          mappedReviewAction === 'reject'
            ? 'This permanently removes unapproved media files from Storage.'
            : mappedReviewAction === 'request_changes'
              ? 'Listing stays hidden from public discovery until the owner resubmits.'
              : undefined,
        impactSummary: [
          `Listing: ${targetListing?.title || listingId}`,
          `Target status: ${mappedReviewAction === 'approve' ? 'published' : mappedReviewAction === 'reject' ? 'rejected / draft' : 'changes_requested'}`,
          ...(trimmedDecisionNote ? [`Note: ${trimmedDecisionNote}`] : []),
        ],
        confirmLabel: action,
        variant:
          mappedReviewAction === 'reject'
            ? 'danger'
            : mappedReviewAction === 'request_changes'
              ? 'warning'
              : 'info',
      });
      if (!confirmed) return;

      const reviewerNotes = trimmedDecisionNote || undefined;

      setAppStatus('saving');

      if (isSupabaseConfigured() && isUuid(listingId)) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
          }
          const reviewRes = await fetch('/api/listings/review', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              listingId,
              action: mappedReviewAction,
              reviewerNotes,
            }),
          });
          const reviewJson = (await reviewRes.json().catch(() => null)) as {
            ok?: boolean;
            error?: string;
          } | null;
          if (!reviewRes.ok || !reviewJson?.ok) {
            throw new Error(reviewJson?.error || 'Listing review failed.');
          }

          const finalLocalStatus: ListingStatus =
            mappedReviewAction === 'approve'
              ? 'published'
              : mappedReviewAction === 'reject'
              ? 'draft'
              : 'changes_requested';
          changeListingStatus(listingId, finalLocalStatus, reviewerNotes);
          setRemotePendingListings((prev) =>
            prev.map((item) =>
              item.id === listingId
                ? { ...item, status: finalLocalStatus }
                : item
            )
          );
          setAppStatus('success');
          setAdminNotice({
            type: 'success',
            text:
              mappedReviewAction === 'approve'
                ? `Approved "${targetListing?.title || listingId}" and promoted media to permanent storage.`
                : mappedReviewAction === 'reject'
                ? `Rejected "${targetListing?.title || listingId}", purged unapproved media, and notified owner.`
                : `Requested changes for "${targetListing?.title || listingId}".`,
          });
          return;
        } catch (err) {
          setAppStatus('error');
          setAdminNotice({
            type: 'error',
            text:
              err instanceof Error
                ? err.message
                : 'Failed to moderate listing on server.',
          });
          return;
        }
      }

      const res = changeListingStatus(listingId, targetStatus, reviewerNotes);
      if (targetListing) {
        void updateListing(
          listingId,
          { status: targetStatus },
          targetListing.ownerId
        ).catch(() => {
          // Local state updated offline
        });
      }

      setRemotePendingListings((prev) =>
        prev.map((item) =>
          item.id === listingId ? { ...item, status: targetStatus } : item
        )
      );

      setAppStatus(res.ok ? 'success' : 'error');
      setAdminNotice({
        type: res.ok ? 'success' : 'error',
        text: res.ok
          ? `${action}: Updated "${targetListing?.title || listingId}" to ${targetStatus.replace(/_/g, ' ')}.`
          : res.message,
      });
    },
    [
      canManageVerification,
      canManageListings,
      currentUser.adminRole,
      verificationQueueListings,
      changeListingStatus,
      decisionNotes,
      confirmModeration,
    ]
  );

  // Columns for User & Role Management
  const userColumns = useMemo<DataColumn<UserAccount>[]>(
    () => [
      {
        id: 'name',
        header: 'User Name & Email',
        accessor: (u) => u.name,
        render: (u) => (
          <div>
            <div className="font-semibold text-[var(--ps-text)]">{u.name}</div>
            <div className="text-xs text-[var(--ps-text-muted)]">{u.email}</div>
          </div>
        ),
      },
      {
        id: 'roleType',
        header: 'Workspace Type',
        accessor: (u) => u.roleType,
        render: (u) => (
          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-xs font-semibold uppercase text-[var(--ps-text-muted)]">
            {u.roleType}
          </span>
        ),
      },
      {
        id: 'adminRole',
        header: 'Assigned Admin Role (7 Role Model)',
        accessor: (u) =>
          u.adminRole ? ADMIN_ROLE_LABELS[u.adminRole] : 'Non-Admin',
        render: (u) => (
          <CustomSelectModal
            value={u.adminRole || ''}
            disabled={!canManageUsers}
            placeholder="Assign role"
            className="min-w-[180px]"
            onChange={(nextVal) => {
              if (!canManageUsers) {
                setAdminNotice({
                  type: 'error',
                  text: `Permission denied: Role "${currentUser.adminRole}" cannot modify user roles.`,
                });
                return;
              }
              const val = nextVal as AdminRole | '';
              const res = updateUserRoleOrStatus(u.id, {
                roleType: val ? 'admin' : 'owner',
                adminRole: val || undefined,
              });
              setAdminNotice({
                type: res.ok ? 'success' : 'error',
                text: res.ok
                  ? `Updated role assignment for ${u.name}.`
                  : res.message,
              });
            }}
            options={[
              { value: '', label: 'Non-Admin (Owner / Staff / Visitor)' },
              ...(Object.keys(ADMIN_ROLE_LABELS) as AdminRole[]).map((role) => ({
                value: role,
                label: ADMIN_ROLE_LABELS[role],
              })),
            ]}
          />
        ),
      },
      {
        id: 'status',
        header: 'Account Status',
        accessor: (u) => u.status,
        render: (u) => (
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
              u.status === 'active'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
          >
            {u.status}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        accessor: (u) => u.id,
        align: 'right',
        render: (u) => (
          <button
            type="button"
            disabled={!canManageUsers}
            onClick={() => {
              const nextStatus =
                u.status === 'active' ? 'suspended' : 'active';
              const res = updateUserRoleOrStatus(u.id, { status: nextStatus });
              setAdminNotice({
                type: res.ok ? 'info' : 'error',
                text: res.ok
                  ? `Account "${u.name}" marked as ${nextStatus}.`
                  : res.message,
              });
            }}
            className={`rounded border px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              u.status === 'active'
                ? 'border-rose-500/30 text-rose-600 hover:bg-rose-500/10'
                : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'
            }`}
          >
            {u.status === 'active' ? 'Suspend User' : 'Restore User'}
          </button>
        ),
      },
    ],
    [canManageUsers, currentUser.adminRole, updateUserRoleOrStatus]
  );

  // Columns for Master Listing Administration
  const masterListingColumns = useMemo<DataColumn<Listing>[]>(
    () => [
      {
        id: 'title',
        header: 'Listing Title',
        accessor: (r) => r.title,
        render: (r) => (
          <div>
            <div className="font-semibold text-[var(--ps-text)]">{r.title}</div>
            <div className="text-xs text-[var(--ps-text-muted)]">
              {r.locality} • Owner: {r.ownerName}
            </div>
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        accessor: (r) => CATEGORY_LABELS[r.category],
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (r) => r.status,
        render: (r) => (
          <CustomSelectModal
            value={r.status}
            disabled={!canManageListings}
            placeholder="Status"
            className="min-w-[150px]"
            onChange={(nextVal) => {
              const next = nextVal as ListingStatus;
              const res = changeListingStatus(r.id, next);
              setAdminNotice({
                type: res.ok ? 'success' : 'error',
                text: res.message,
              });
            }}
            options={[
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft' },
              { value: 'submitted', label: 'Submitted' },
              { value: 'pending_verification', label: 'Pending Verification' },
              { value: 'changes_requested', label: 'Changes Requested' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
        ),
      },
      {
        id: 'verification',
        header: 'Verification Badge',
        accessor: (r) => r.verificationStatus,
        render: (r) => (
          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-xs font-medium">
            {r.verificationStatus.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        id: 'panoramaCheck',
        header: '360° Tour Media',
        accessor: (r) =>
          r.category === 'real_estate'
            ? (r.realEstateDetails?.panoramas?.length || 0) > 0
              ? '360° Included'
              : 'Optional (None)'
            : 'N/A',
        render: (r) =>
          r.category === 'real_estate' ? (
            (r.realEstateDetails?.panoramas?.length || 0) > 0 ? (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                ✓ {r.realEstateDetails?.panoramas.length}× 2:1 Equirectangular
              </span>
            ) : (
              <span className="text-xs font-medium text-[var(--ps-text-muted)]">
                Optional (No 360° uploaded)
              </span>
            )
          ) : (
            <span className="text-xs text-[var(--ps-text-muted)]">
              Not Required
            </span>
          ),
      },
      {
        id: 'actions',
        header: 'Inspect',
        accessor: (r) => r.id,
        align: 'right',
        render: (r) => (
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setPreviewListing(r)}
              className="rounded border border-[var(--ps-border)] px-2 py-1 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              Preview
            </button>
            <button
              type="button"
              data-testid={`admin-locate-on-map-${r.id}`}
              aria-label={`Locate ${r.title} on Discovery Map`}
              onClick={() => onOpenListingOnMap(r.id)}
              className="rounded border border-[var(--ps-border)] px-2 py-1 text-xs font-medium text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
            >
              Map Pin
            </button>
          </div>
        ),
      },
    ],
    [
      canManageListings,
      changeListingStatus,
      onOpenListingOnMap,
    ]
  );

  // Columns for Admin Verification Queue DataTable
  const verificationQueueColumns = useMemo<DataColumn<Listing>[]>(
    () => [
      {
        id: 'title',
        header: 'Listing & Locality',
        accessor: (item) => item.title,
        sortValue: (item) => item.title,
        render: (item) => (
          <div>
            <div className="font-bold text-[var(--ps-text)]">{item.title}</div>
            <div className="text-xs text-[var(--ps-text-muted)]">
              {item.locality} • ID: <span className="font-mono">{item.id}</span>
            </div>
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        accessor: (item) => CATEGORY_LABELS[item.category] || item.category,
        sortValue: (item) => CATEGORY_LABELS[item.category] || item.category,
        render: (item) => (
          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--ps-accent)]">
            {CATEGORY_LABELS[item.category] || item.category}
          </span>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        accessor: (item) => item.ownerName,
        sortValue: (item) => item.ownerName,
      },
      {
        id: 'status',
        header: 'Queue Status',
        accessor: (item) => item.status,
        sortValue: (item) => item.status,
        render: (item) => (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">
            {item.status.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Moderation Actions',
        accessor: (item) => item.id,
        align: 'right',
        render: (item) => (
          <div className="flex justify-end">
            <ModerationControls
              listingId={item.id}
              disabled={!canManageVerification && !canManageListings}
              onModerate={handleModerateListing}
            />
          </div>
        ),
      },
    ],
    [canManageVerification, canManageListings, handleModerateListing]
  );

  // Columns for Verification Evidence Requests DataTable
  const verificationRequestColumns = useMemo<DataColumn<VerificationRequest>[]>(
    () => [
      {
        id: 'listingTitle',
        header: 'Listing & Owner',
        accessor: (req) => req.listingTitle,
        sortValue: (req) => req.listingTitle,
        render: (req) => (
          <div>
            <div className="font-bold text-[var(--ps-text)]">
              {req.listingTitle}
            </div>
            <div className="text-xs text-[var(--ps-text-muted)]">
              Submitted by {req.ownerName} on {req.submittedAt}
            </div>
          </div>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        accessor: (req) => CATEGORY_LABELS[req.category] || req.category,
        render: (req) => (
          <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--ps-accent)]">
            {CATEGORY_LABELS[req.category] || req.category}
          </span>
        ),
      },
      {
        id: 'evidenceSummary',
        header: 'Evidence Summary',
        accessor: (req) => req.evidenceSummary,
        render: (req) => (
          <span className="text-xs text-[var(--ps-text-muted)]">
            {req.evidenceSummary}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (req) => req.status,
        render: (req) => (
          <span className="rounded border border-[var(--ps-border)] px-2 py-0.5 text-[11px] font-semibold uppercase">
            {req.status.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        accessor: (req) => req.id,
        align: 'right',
        render: (req) => (
          <div className="flex flex-wrap justify-end items-center gap-1.5">
            <input
              type="text"
              disabled={!canManageVerification}
              value={decisionNotes[req.id] || req.decisionReason || ''}
              onChange={(e) =>
                setDecisionNotes({
                  ...decisionNotes,
                  [req.id]: e.target.value,
                })
              }
              placeholder="Decision note..."
              className="w-36 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs text-[var(--ps-text)] disabled:opacity-55"
            />
            <button
              type="button"
              disabled={!canManageVerification}
              onClick={() => {
                if (!canManageVerification) return;
                decideVerificationRequest(
                  req.id,
                  'approved',
                  decisionNotes[req.id] || 'Evidence verified.'
                );
                setAdminNotice({
                  type: 'success',
                  text: `Approved verification for "${req.listingTitle}".`,
                });
              }}
              className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={!canManageVerification}
              onClick={() => {
                if (!canManageVerification) return;
                decideVerificationRequest(
                  req.id,
                  'rejected',
                  decisionNotes[req.id] || 'Evidence mismatch.'
                );
                setAdminNotice({
                  type: 'error',
                  text: `Rejected verification for "${req.listingTitle}".`,
                });
              }}
              className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        ),
      },
    ],
    [canManageVerification, decisionNotes, decideVerificationRequest]
  );

  return (
    <div className="w-full max-w-7xl mx-auto min-w-0 overflow-x-clip py-2">
      {/* Compact Mobile-First Header */}
      <div className="mb-4 sm:mb-6 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 shadow-2xs">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Administrator Command Centre
            </span>
            <span
              data-testid="admin-workspace-role-badge"
              className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300"
            >
              Role: {adminRoleDisplay.replace(/_/g, ' ')}
            </span>
            {isSuperAdminExclusive ? (
              <button
                type="button"
                data-testid="admin-live-mode-status-chip"
                onClick={() => setActiveTab('payment_methods')}
                title="Open Payment Methods & Live Mode"
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>{paymentModeChipLabel}</span>
                <span className="opacity-40">·</span>
                <span
                  className={
                    operations.hide_sample_data
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {productionModeChipLabel}
                </span>
              </button>
            ) : (
              <span
                data-testid="admin-live-mode-status-chip"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]"
              >
                <span>{paymentModeChipLabel}</span>
                <span className="opacity-40">·</span>
                <span>{productionModeChipLabel}</span>
              </span>
            )}
            <span
              data-testid="admin-workspace-greeting"
              className="text-xs text-[var(--ps-text-muted)]"
            >
              Welcome back,{' '}
              <strong className="text-[var(--ps-text)]">
                {adminGreetingName}
              </strong>{' '}
              (
              {currentUser.adminRole
                ? ADMIN_ROLE_LABELS[currentUser.adminRole]
                : 'Super Administrator'}
              )
            </span>
          </div>
          <h1 className="mt-1.5 text-base sm:text-xl font-bold leading-snug break-words tracking-tight text-[var(--ps-text)]">
            Hello {adminGreetingName} — Platform Governance &amp; Audit Controls
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ps-text-muted)] line-clamp-2 sm:line-clamp-none">
            Supervise all {combinedListings.length} district listings, 7-tier administrator roles, verification evidence, moderation queues, and boundary geometry.
          </p>
        </div>

        {/* Phase 14-B: CSV Import / Export Action Buttons */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            data-testid="admin-bulk-import-csv-input"
            onChange={handleBulkImportCsvChange}
            className="hidden"
          />
          <button
            type="button"
            data-testid="admin-export-csv-btn"
            onClick={handleExportCsv}
            className="inline-flex h-8 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] shadow-2xs transition hover:bg-[var(--ps-surface-alt)] cursor-pointer truncate"
          >
            <Download className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
            <span className="truncate">Export CSV</span>
          </button>
          <button
            type="button"
            data-testid="admin-bulk-import-csv-btn"
            disabled={isImportingCsv || !canManageListings}
            onClick={() => csvFileInputRef.current?.click()}
            className="inline-flex h-8 sm:h-9 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer truncate"
          >
            {isImportingCsv ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                <span className="truncate">Importing…</span>
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Import CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Least-Privilege Admin Role Scope Banner (Task 4) */}
      <div
        data-testid="admin-role-scope-banner"
        className={`mb-5 rounded-xl border p-3.5 text-xs ${
          activeRolePermissions.length === 0
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
            : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-bold">
              Least-Privilege Role Enforcement ({currentUser.adminRole || 'super_admin'}):{' '}
            </span>
            <span className="text-[var(--ps-text-muted)]">
              {currentUser.adminRole
                ? ADMIN_ROLE_DESCRIPTIONS[currentUser.adminRole]
                : ADMIN_ROLE_DESCRIPTIONS.super_admin}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {activeRolePermissions.length === 0 ? (
              <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                Strictly Read-Only Mode
              </span>
            ) : (
              activeRolePermissions.map((perm) => (
                <span
                  key={perm}
                  className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                >
                  ✓ {perm.replace(/_/g, ' ')}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Status Notice */}
      {adminNotice && (
        <div
          className={`mb-5 flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            adminNotice.type === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
              : adminNotice.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                : 'border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200'
          }`}
        >
          <span>{adminNotice.text}</span>
          <button
            type="button"
            onClick={() => setAdminNotice(null)}
            className="rounded p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Renovated Responsive 5-Group Nested Superadmin Shell */}
      <SuperadminNavShell
        activeId={activeTab}
        onSelect={(id) => setActiveTab(id as AdminTab)}
        groups={
          [
            {
              id: 'overview',
              label: 'Command Overview',
              icon: Layers,
              items: [
                {
                  id: 'command',
                  label: 'Command Centre',
                  shortLabel: 'Overview',
                  icon: Layers,
                },
              ],
            },
            {
              id: 'operations',
              label: 'Operations & Moderation',
              icon: Shield,
              items: [
                {
                  id: 'listings',
                  label: 'Listings Queue',
                  shortLabel: 'Listings',
                  icon: Database,
                  badge: combinedListings.length,
                },
                {
                  id: 'partner_applications',
                  label: 'Partner Applications & KYC',
                  shortLabel: 'Partners',
                  icon: UserCheck,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'bulletins',
                  label: 'Bulletins & Notices',
                  shortLabel: 'Bulletins',
                  icon: Newspaper,
                  hidden: !['admin', 'super_admin'].includes(
                    String(adminRoleDisplay || '').toLowerCase()
                  ),
                },
                {
                  id: 'moderation_civic',
                  label: 'Reviews, Moderation & Civic',
                  shortLabel: 'Moderation',
                  icon: Flag,
                  badge:
                    commandMetrics.pendingVerifications +
                    commandMetrics.openModeration,
                },
                {
                  id: 'escrow_disputes',
                  label: 'Escrow, Fleet & Disputes',
                  shortLabel: 'Escrow',
                  icon: Truck,
                  hidden: !['admin', 'super_admin'].includes(
                    String(adminRoleDisplay || '').toLowerCase()
                  ),
                },
              ],
            },
            {
              id: 'builders',
              label: 'Platform Builders',
              icon: LayoutGrid,
              items: [
                {
                  id: 'homepage_builder',
                  label: 'Homepage Builder',
                  shortLabel: 'Homepage',
                  icon: LayoutGrid,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'categories_icons',
                  label: 'Categories & Icons',
                  shortLabel: 'Categories',
                  icon: FolderTree,
                },
                {
                  id: 'subscription_plans',
                  label: 'Subscription Plans',
                  shortLabel: 'Plans',
                  icon: BadgePercent,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'pay_per_monetization',
                  label: 'Pay-Per Pricing & Orders',
                  shortLabel: 'Pay-Per',
                  icon: IndianRupee,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'payment_methods',
                  label: 'Payment Methods',
                  shortLabel: 'Payments',
                  icon: CreditCard,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'hubs_brand',
                  label: 'Hubs, Brand & Ops',
                  shortLabel: 'Hubs & Brand',
                  icon: Building2,
                  hidden: !isSuperAdminExclusive,
                },
              ],
            },
            {
              id: 'governance',
              label: 'People & Governance',
              icon: Users,
              items: [
                {
                  id: 'users_roles',
                  label: 'Users & Roles',
                  shortLabel: 'Users',
                  icon: Users,
                  badge: combinedUsers.length,
                },
                {
                  id: 'subscribers',
                  label: 'Subscribers & Referrals',
                  shortLabel: 'Referrals',
                  icon: Gift,
                  hidden: !isSuperAdminExclusive,
                },
                {
                  id: 'audit_logs',
                  label: 'Audit Logs',
                  shortLabel: 'Audit Logs',
                  icon: Activity,
                },
              ],
            },
            {
              id: 'system',
              label: 'Data & System',
              icon: Settings,
              items: [
                {
                  id: 'data_import_export',
                  label: 'CSV / Excel Import-Export',
                  shortLabel: 'CSV Data',
                  icon: FileSpreadsheet,
                },
                {
                  id: 'system_health',
                  label: 'System Health & QA',
                  shortLabel: 'System',
                  icon: Settings,
                },
              ],
            },
          ] satisfies SuperadminNavGroup[]
        }
      >

      {/* TAB 1: COMMAND CENTRE */}
      {activeTab === 'command' && (
        <div className="space-y-6">
          <CommandCenterOverview
            onNavigate={(tab, subView) => {
              setActiveTab(tab as AdminTab);
              if (
                tab === 'moderation_civic' &&
                (subView === 'verification' ||
                  subView === 'moderation' ||
                  subView === 'civic')
              ) {
                setModerationSubView(subView);
              }
            }}
            localPendingCounts={{
              listings: verificationQueueListings.length,
              verifications: commandMetrics.pendingVerifications,
              moderation: commandMetrics.openModeration,
              totalListings: combinedListings.length,
            }}
          />

          {/* Compact Pending Listings Quick-Action Queue (only if any pending locally) */}
          {verificationQueueListings.length > 0 && (
            <section
              data-testid="admin-pending-verification-queue"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-[var(--ps-text)]">
                    Pending Listing Approvals ({verificationQueueListings.length})
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Quick-approve listings or open the full Listings Queue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('listings')}
                  className="inline-flex min-h-[36px] items-center text-xs font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
                >
                  Open Listings Queue →
                </button>
              </div>

              <div className="divide-y divide-[var(--ps-border)]/70">
                {verificationQueueListings.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    data-testid={`pending-queue-row-${item.id}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--ps-text)] truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-[var(--ps-text-muted)]">
                        {CATEGORY_LABELS[item.category] || item.category} •{' '}
                        {item.locality} • Status:{' '}
                        <span className="font-mono uppercase">{item.status}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!canManageVerification && !canManageListings}
                        onClick={() =>
                          void handleModerateListing(
                            item.id,
                            'published',
                            'Approve'
                          )
                        }
                        data-testid={`pending-approve-btn-${item.id}`}
                        className="min-h-[44px] rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!canManageVerification && !canManageListings}
                        onClick={() =>
                          void handleModerateListing(
                            item.id,
                            'rejected',
                            'Reject'
                          )
                        }
                        data-testid={`pending-reject-btn-${item.id}`}
                        className="min-h-[44px] rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* PEOPLE & GOVERNANCE: USERS & ROLES (Consolidated single live Supabase Role & Team Manager — P2-06) */}
      {activeTab === 'users_roles' && (
        <div className="space-y-6">
          <MasterControlConsole
            controlledSubTab="users_drivers_managers"
            hideChrome={true}
            onNotice={setAdminNotice}
          />
        </div>
      )}

      {/* OPERATIONS: LISTINGS QUEUE & REVIEWS */}
      {activeTab === 'listings' && (
        <div className="space-y-4">
          {isSuperAdminExclusive && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'master', label: 'Listing Master Table' },
                  { id: 'reviews', label: 'Pending Media & Listing Reviews' },
                ] as const
              ).map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setListingsSubView(sub.id)}
                  className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                    listingsSubView === sub.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}

          {listingsSubView === 'reviews' && isSuperAdminExclusive ? (
            <MasterControlConsole
              controlledSubTab="listing_reviews"
              hideChrome={true}
              onNotice={setAdminNotice}
            />
          ) : (
            <DataTable
              title="Master Listing Administration"
              subtitle="Filter, inspect, or perform bulk status changes across all listings. Real-estate listings without a valid 360° equirectangular panorama are automatically blocked from publication."
              data={combinedListings}
              columns={masterListingColumns}
              rowKey={(r) => r.id}
              exportFilename="printswift-master-listings"
              bulkActions={
                canManageListings
                  ? [
                      {
                        label: 'Bulk Publish',
                        onClick: (ids) => {
                          void (async () => {
                            const ok = await confirmModeration({
                              title: `Bulk Publish ${ids.length} Listing(s)?`,
                              description: `Set ${ids.length} selected listing(s) to published status. Real-estate listings missing a 360° panorama remain automatically blocked.`,
                              impactSummary: [`Selected rows: ${ids.length}`],
                              confirmLabel: 'Publish Selected',
                              variant: 'warning',
                            });
                            if (!ok) return;
                            const res = bulkUpdateListingStatus(ids, 'published');
                            setAdminNotice({
                              type: res.permissionDenied
                                ? 'error'
                                : res.blocked > 0
                                  ? 'info'
                                  : 'success',
                              text:
                                res.message ||
                                `Published ${res.updated} listings (${res.blocked} real-estate items blocked due to missing 360° panorama).`,
                            });
                          })();
                        },
                      },
                      {
                        label: 'Bulk Request Changes',
                        onClick: (ids) => {
                          void (async () => {
                            const ok = await confirmModeration({
                              title: `Request Changes on ${ids.length} Listing(s)?`,
                              description: `Move ${ids.length} selected listing(s) to changes_requested so owners update them before publication.`,
                              impactSummary: [`Selected rows: ${ids.length}`],
                              confirmLabel: 'Request Changes',
                              variant: 'warning',
                            });
                            if (!ok) return;
                            const res = bulkUpdateListingStatus(
                              ids,
                              'changes_requested'
                            );
                            setAdminNotice({
                              type: res.permissionDenied ? 'error' : 'info',
                              text:
                                res.message ||
                                `Marked ${res.updated} listings as Changes Requested.`,
                            });
                          })();
                        },
                      },
                      {
                        label: 'Bulk Suspend',
                        variant: 'danger',
                        onClick: (ids) => {
                          void (async () => {
                            const ok = await confirmModeration({
                              title: `Suspend ${ids.length} Listing(s)?`,
                              description: `Immediately suspend ${ids.length} selected listing(s) and hide them from public discovery.`,
                              caution:
                                'Suspended listings disappear from public search and map pins until reinstated.',
                              impactSummary: [`Selected rows: ${ids.length}`],
                              confirmLabel: 'Suspend Selected',
                              variant: 'danger',
                            });
                            if (!ok) return;
                            const res = bulkUpdateListingStatus(ids, 'suspended');
                            setAdminNotice({
                              type: res.permissionDenied ? 'error' : 'info',
                              text:
                                res.message || `Suspended ${res.updated} listings.`,
                            });
                          })();
                        },
                      },
                    ]
                  : undefined
              }
            />
          )}
        </div>
      )}

      {/* OPERATIONS: REVIEWS, MODERATION & CIVIC SUB-SWITCHER (Consolidated live Supabase queues — P2-06) */}
      {activeTab === 'moderation_civic' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'verification',
                label: `Verification Queue (${verificationQueueListings.length})`,
              },
              { id: 'civic', label: 'Public & Civic Desk' },
            ] as const
          ).map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setModerationSubView(sub.id)}
              className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                moderationSubView === sub.id
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {/* VERIFICATION CENTRE SUB-VIEW */}
      {activeTab === 'moderation_civic' &&
        moderationSubView !== 'civic' && (
        <div className="space-y-6">
          <DataTable
            title={`Verification Queue (${verificationQueueListings.length})`}
            subtitle="Listings awaiting administrative moderation (pending_verification / submitted). Use row controls or bulk actions to Approve or Reject."
            data={verificationQueueListings}
            columns={verificationQueueColumns}
            rowKey={(item) => item.id}
            searchPlaceholder="Search pending listings..."
            exportFilename="printswift-verification-queue"
            emptyMessage="No listings are currently pending moderation in the Verification Queue."
            bulkActions={
              canManageVerification || canManageListings
                ? [
                    {
                      label: 'Bulk Approve (Publish)',
                      onClick: (ids) => {
                        ids.forEach((id) => {
                          void handleModerateListing(id, 'published', 'Approve');
                        });
                      },
                    },
                    {
                      label: 'Bulk Reject',
                      variant: 'danger',
                      onClick: (ids) => {
                        ids.forEach((id) => {
                          void handleModerateListing(id, 'rejected', 'Reject');
                        });
                      },
                    },
                  ]
                : undefined
            }
          />
        </div>
      )}

      {/* SYSTEM HEALTH SUB-SWITCHER (Consolidated live Supabase health, media & localization — P2-06) */}
      {activeTab === 'system_health' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ...(isSuperAdminExclusive
                ? ([
                    { id: 'health', label: 'Production Mode & 48h POD Purge' },
                    { id: 'media', label: 'Loose-Ends & Media' },
                  ] as const)
                : ([] as const)),
              { id: 'localization', label: 'Localization (EN/Paite/MNI)' },
            ] satisfies Array<{
              id: 'health' | 'media' | 'localization' | 'geographic' | 'settings';
              label: string;
            }>
          ).map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => setSystemSubView(sub.id)}
              className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                systemSubView === sub.id
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {/* PLATFORM BUILDERS: CATEGORIES & ICONS (Consolidated single canonical 3-Level CategoryBuilder — P2-06) */}
      {activeTab === 'categories_icons' && (
        <div className="space-y-6">
          <CategoryBuilder onNotice={setAdminNotice} />
        </div>
      )}

      {/* LOCALIZATION MANAGER SUB-VIEW */}
      {activeTab === 'system_health' && systemSubView === 'localization' && (
        <LocalizationManagerSection
          canManageTranslations={
            canManageSettings || adminRoleDisplay === 'super_admin'
          }
          onNotice={setAdminNotice}
        />
      )}

      {/* OPERATIONS: PARTNER APPLICATIONS & KYC */}
      {activeTab === 'partner_applications' && isSuperAdminExclusive && (
        <MasterControlConsole
          controlledSubTab="partner_applications"
          hideChrome={true}
          onNotice={setAdminNotice}
        />
      )}

      {/* OPERATIONS: BULLETINS & SUBSCRIPTION PLANS */}
      {activeTab === 'bulletins' &&
        ['admin', 'super_admin'].includes(
          String(adminRoleDisplay || '').toLowerCase()
        ) && (
          <AdminBulletinManager
            fallbackUsers={users}
            onNotice={setAdminNotice}
          />
        )}

      {/* OPERATIONS: PUBLIC & CIVIC SUB-VIEW */}
      {activeTab === 'moderation_civic' && moderationSubView === 'civic' && (
        <CivicDirectoryManager
          hubs={hubs}
          hubId={activeHub?.id}
          isSuperAdmin={isSuperAdminExclusive}
          onNotice={setAdminNotice}
        />
      )}

      {/* OPERATIONS: ESCROW, FLEET & DISPUTES */}
      {activeTab === 'escrow_disputes' &&
        ['admin', 'super_admin'].includes(
          String(adminRoleDisplay || '').toLowerCase()
        ) && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'pick_n_drop', label: 'Pick N Drop, Fleet & Escrow' },
                  ...(isSuperAdminExclusive
                    ? ([
                        { id: 'payments_queue', label: 'Unified Payments Queue' },
                        { id: 'print_settlements', label: 'Print & Settlements' },
                      ] as const)
                    : ([] as const)),
                ] satisfies Array<{
                  id: 'pick_n_drop' | 'payments_queue' | 'print_settlements';
                  label: string;
                }>
              ).map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setEscrowSubView(sub.id)}
                  className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                    escrowSubView === sub.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {escrowSubView === 'pick_n_drop' && (
              <MediatorDeskRedirectCard />
            )}
            {escrowSubView === 'payments_queue' && isSuperAdminExclusive && (
              <MediatorDeskRedirectCard title="Manual payments moved to the Mediator Desk" />
            )}
            {escrowSubView === 'print_settlements' && isSuperAdminExclusive && (
              <MasterControlConsole
                controlledSubTab="print_settlements"
                hideChrome={true}
                onNotice={setAdminNotice}
              />
            )}
          </div>
        )}

      {/* PLATFORM BUILDERS: HOMEPAGE BUILDER (v15c) */}
      {activeTab === 'homepage_builder' && isSuperAdminExclusive && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'builder', label: 'Homepage Builder & Fleet Rates' },
                { id: 'banners', label: 'Banners & Offers' },
                { id: 'featured', label: 'Featured Slots' },
              ] as const
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setHomepageSubView(sub.id)}
                className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                  homepageSubView === sub.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {homepageSubView === 'builder' && (
            <HomepageBuilder onNotice={setAdminNotice} />
          )}
          {homepageSubView === 'banners' && (
            <MasterControlConsole
              controlledSubTab="banners_offers"
              hideChrome={true}
              onNotice={setAdminNotice}
            />
          )}
          {homepageSubView === 'featured' && (
            <MasterControlConsole
              controlledSubTab="featured_placements"
              hideChrome={true}
              onNotice={setAdminNotice}
            />
          )}
        </div>
      )}

      {/* PLATFORM BUILDERS: SUBSCRIPTION PLANS (Consolidated single canonical SubscriptionPlansBuilder — P2-06) */}
      {activeTab === 'subscription_plans' && isSuperAdminExclusive && (
        <div className="space-y-4">
          <SubscriptionPlansBuilder onNotice={setAdminNotice} />
        </div>
      )}

      {/* PLATFORM BUILDERS: PAY-PER MONETIZATION STUDIO (v17c) */}
      {activeTab === 'pay_per_monetization' && isSuperAdminExclusive && (
        <PayPerMonetizationStudio onNotice={setAdminNotice} />
      )}

      {/* PLATFORM BUILDERS: PAYMENT METHODS (v15b) */}
      {activeTab === 'payment_methods' && isSuperAdminExclusive && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'matrix', label: '3-Tier Payment Matrix' },
                { id: 'gateway', label: 'Gateway & UPI Keys' },
              ] as const
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setPaymentMethodsSubView(sub.id)}
                className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                  paymentMethodsSubView === sub.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {paymentMethodsSubView === 'matrix' ? (
            <PaymentMethodsMatrix onNotice={setAdminNotice} />
          ) : (
            <MasterControlConsole
              controlledSubTab="payments"
              hideChrome={true}
              onNotice={setAdminNotice}
            />
          )}
        </div>
      )}

      {/* PLATFORM BUILDERS: HUBS, BRAND & OPERATIONS */}
      {activeTab === 'hubs_brand' && isSuperAdminExclusive && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'hubs_rates', label: 'Hubs & Rates' },
                { id: 'brand_legal', label: 'Brand, Office & Legal' },
                { id: 'taxonomy', label: 'Taxonomy & Geofence' },
                { id: 'helpbot', label: 'Helpbot Q&A' },
                { id: 'operations', label: 'Operations & Switches' },
              ] as const
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setHubsBrandSubView(sub.id)}
                className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                  hubsBrandSubView === sub.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          <MasterControlConsole
            controlledSubTab={hubsBrandSubView}
            hideChrome={true}
            onNotice={setAdminNotice}
          />
        </div>
      )}

      {/* PEOPLE & GOVERNANCE: SUBSCRIBERS & REFERRALS (v15b) */}
      {activeTab === 'subscribers' && isSuperAdminExclusive && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'subscribers', label: 'Subscribers & Overrides' },
                { id: 'referrals', label: 'Referrals & Fees' },
              ] as const
            ).map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => setSubscribersSubView(sub.id)}
                className={`inline-flex min-h-[40px] items-center rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                  subscribersSubView === sub.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {subscribersSubView === 'subscribers' ? (
            <SubscribersManager onNotice={setAdminNotice} />
          ) : (
            <MasterControlConsole
              controlledSubTab="referrals"
              hideChrome={true}
              onNotice={setAdminNotice}
            />
          )}
        </div>
      )}

      {/* PEOPLE & GOVERNANCE: LIVE IMMUTABLE AUDIT LOGS */}
      {activeTab === 'audit_logs' && (
        <div className="space-y-6">
          <AuditLogsViewer />
        </div>
      )}

      {/* DATA & SYSTEM: CSV / EXCEL IMPORT-EXPORT */}
      {activeTab === 'data_import_export' && (
        <section className="space-y-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-[var(--ps-accent)]" />
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Directory CSV / Spreadsheet Import &amp; Export
                </h2>
              </div>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Bulk-export all {combinedListings.length} district listings for offline spreadsheet review, or import verified CSV rows directly into Supabase.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <Download className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Export {combinedListings.length} Listings (CSV)</span>
              </button>
              <button
                type="button"
                disabled={isImportingCsv || !canManageListings}
                onClick={() => csvFileInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-55 cursor-pointer"
              >
                {isImportingCsv ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span>{isImportingCsv ? 'Importing CSV…' : 'Upload CSV File'}</span>
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                Total Listings
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--ps-text)]">
                {combinedListings.length}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                Pending Verification
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--ps-text)]">
                {verificationQueueListings.length}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                Below 80% Completeness
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--ps-text)]">
                {commandMetrics.incompleteListings.length}
              </div>
            </div>
          </div>

          {pendingCsvImport && (
            <div
              data-testid="csv-import-preview-card"
              className="rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-amber-500/20 pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      CSV Import Preview — {pendingCsvImport.fileName}
                    </h3>
                  </div>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Review parsed row counts and validation warnings before committing writes to Supabase.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isImportingCsv}
                    onClick={() => setPendingCsvImport(null)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Discard Preview</span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      isImportingCsv ||
                      pendingCsvImport.validListings.length === 0 ||
                      !canManageListings
                    }
                    onClick={() => void handleConfirmBulkCsvImport()}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50 cursor-pointer"
                  >
                    {isImportingCsv ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>
                      Commit {pendingCsvImport.validListings.length} Valid Row(s)
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded-xl border border-emerald-500/30 bg-[var(--ps-surface)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Valid Rows Ready
                  </div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {pendingCsvImport.validListings.length}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-[var(--ps-surface)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Validation Errors
                  </div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                    {pendingCsvImport.errors.length}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
                  <div className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Total Rows Scanned
                  </div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums text-[var(--ps-text)]">
                    {pendingCsvImport.validListings.length +
                      pendingCsvImport.errors.length}
                  </div>
                </div>
              </div>

              {pendingCsvImport.errors.length > 0 && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>
                      Validation Warnings ({pendingCsvImport.errors.length})
                    </span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                    {pendingCsvImport.errors.slice(0, 6).map((err, idx) => (
                      <li key={idx}>
                        {err.row ? `Row ${err.row}: ` : ''}
                        {err.message}
                      </li>
                    ))}
                    {pendingCsvImport.errors.length > 6 && (
                      <li>
                        …and {pendingCsvImport.errors.length - 6} additional warning(s).
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {pendingCsvImport.validListings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Sample Valid Rows (First{' '}
                    {Math.min(5, pendingCsvImport.validListings.length)})
                  </div>
                  <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]">
                    {pendingCsvImport.validListings.slice(0, 5).map((item, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                      >
                        <div className="font-semibold text-[var(--ps-text)]">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {CATEGORY_LABELS[item.category] || item.category} ·{' '}
                          {item.locality || item.address || 'Churachandpur'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* DATA & SYSTEM: HEALTH & MEDIA SUB-VIEWS */}
      {activeTab === 'system_health' &&
        systemSubView === 'health' &&
        isSuperAdminExclusive && (
          <SuperAdminSystemAuditSection onNotice={setAdminNotice} />
        )}

      {activeTab === 'system_health' &&
        systemSubView === 'media' &&
        isSuperAdminExclusive && (
          <MasterControlConsole
            controlledSubTab="loose_ends_media"
            hideChrome={true}
            onNotice={setAdminNotice}
          />
        )}
      </SuperadminNavShell>

      {/* PREVIEW MODAL */}
      {previewListing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl">
            <CategoryDetailView
              listing={previewListing}
              mode="modal"
              onClose={() => setPreviewListing(null)}
              onLocateOnMap={(l) => {
                setPreviewListing(null);
                onOpenListingOnMap(l.id);
              }}
            />
          </div>
        </div>
      )}

      {moderationConfirmDialog}
    </div>
  );
}
