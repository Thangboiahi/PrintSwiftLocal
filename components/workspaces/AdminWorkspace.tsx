'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CreditCard,
  Crown,
  Database,
  Download,
  FileCheck2,
  Flag,
  Globe,
  Landmark,
  Layers,
  Loader2,
  MapPin,
  Newspaper,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sliders,
  Trash2,
  Truck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
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
  AuditLogEntry,
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
  hasValidMandatoryPanorama,
} from '@/lib/rules';
import { DataTable, DataColumn } from '@/components/shared/DataTable';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { CategoryDetailView } from '@/components/listings/CategoryDetailView';
import {
  ModerationActionType,
  ModerationControls,
} from '@/components/shared/ModerationControls';
import { ActivityFeed } from '@/components/shared/ActivityFeed';
import { AdminBulletinManager } from '@/components/workspaces/AdminBulletinManager';
import { PickNDropConsole } from '@/components/workspaces/PickNDropConsole';
import { MasterControlConsole } from '@/components/workspaces/MasterControlConsole';
import { UnifiedPaymentsQueue } from '@/components/workspaces/UnifiedPaymentsQueue';
import { CivicDirectoryManager } from '@/components/workspaces/civic/CivicDirectoryManager';
import { useAppConfig, useHub } from '@/components/providers/AppConfigProvider';
import {
  SuperAdminRatesPlansSection,
  SuperAdminSystemAuditSection,
  SuperAdminUsersRolesSection,
} from '@/components/workspaces/SuperAdminPanel';

interface AdminWorkspaceProps {
  onOpenListingOnMap: (listingId: string) => void;
}

type AdminTab =
  | 'command'
  | 'master_control'
  | 'payments_queue'
  | 'users'
  | 'listings'
  | 'verification'
  | 'moderation'
  | 'bulletins'
  | 'pick_n_drop'
  | 'public_civic'
  | 'rates_plans'
  | 'system_audit'
  | 'geographic'
  | 'dynamic_fields'
  | 'localization'
  | 'settings'
  | 'audit';

const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Administrator',
  listing_moderator: 'Listing Moderator',
  verification_officer: 'Verification Officer',
  community_moderator: 'Community Moderator',
  customer_support: 'Customer Support',
  finance_admin: 'Finance/Commercial Administrator',
  analytics_viewer: 'Analytics Viewer',
};

const ROLE_LADDER: GovernedUserRole[] = [
  'visitor',
  'staff',
  'owner',
  'admin',
  'super_admin',
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
      if (!canManageUsers) {
        onNotice({
          type: 'error',
          text: 'RLS Restriction: Only Super Admins (role = super_admin) can promote or demote user roles.',
        });
        return;
      }

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
    [canManageUsers, onNotice, onUpdateLocalUserRole]
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
    [canManageSettings, onNotice, onToggleSampleData]
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
          const ladderIdx = ROLE_LADDER.indexOf(currentRole);
          const canPromote = ladderIdx >= 0 && ladderIdx < ROLE_LADDER.length - 1;
          const canDemote = ladderIdx > 0;
          const isRowUpdating = updatingUserId === u.id;

          return (
            <div className="flex flex-wrap items-center gap-2">
              <select
                data-testid={`governance-role-select-${u.id}`}
                aria-label={`Change role for ${u.name}`}
                value={currentRole}
                disabled={!canManageUsers || isRowUpdating}
                onChange={(e) => {
                  const nextRole = e.target.value as GovernedUserRole;
                  void handleChangeGovernedRole(u, nextRole);
                }}
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                <option value="visitor">Visitor</option>
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>

              <button
                type="button"
                data-testid={`governance-promote-btn-${u.id}`}
                disabled={!canManageUsers || !canPromote || isRowUpdating}
                onClick={() => {
                  if (!canPromote) return;
                  const nextRole = ROLE_LADDER[ladderIdx + 1];
                  void handleChangeGovernedRole(u, nextRole);
                }}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300"
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
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-300"
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
        subtitle="Select a target role or click Promote / Demote (Visitor → Staff → Owner → Admin → Super Admin) to update public.profiles."
        data={governedUsers}
        columns={governanceColumns}
        rowKey={(u) => u.id}
        searchPlaceholder="Search users by name, email, or role..."
        exportFilename="printswift-governance-users"
      />
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
    auditLogs,
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
  const [adminNotice, setAdminNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const [previewListing, setPreviewListing] = useState<Listing | null>(null);
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
        text: `Parsing and validating "${file.name}"...`,
      });

      try {
        const ownerId = currentUser.id || 'admin-bulk-import';
        const ownerName = currentUser.name || 'Administrator';
        const parsed = await parseListingsCsvFile(file, {
          defaultOwnerId: ownerId,
          defaultOwnerName: ownerName,
        });

        if (parsed.validListings.length === 0) {
          const errSummary =
            parsed.errors.map((err) => err.message).join(' ') ||
            'No valid rows found. Ensure required columns (title, category_id, address) are present.';
          setAdminNotice({
            type: 'error',
            text: `CSV Import aborted: ${errSummary}`,
          });
          return;
        }

        const createdListings: Listing[] = [];
        const failedMessages: string[] = [];

        for (const item of parsed.validListings) {
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
          parsed.errors.length > 0
            ? ` (${parsed.errors.length} invalid row(s) skipped)`
            : '';
        const failureWarning =
          failedMessages.length > 0
            ? ` (${failedMessages.length} failed: ${failedMessages.slice(0, 2).join('; ')})`
            : '';

        setAdminNotice({
          type: createdListings.length > 0 ? 'success' : 'error',
          text:
            createdListings.length > 0
              ? `Bulk imported ${createdListings.length} listing(s) from "${file.name}".${validationWarning}${failureWarning}`
              : `Failed to import listings from "${file.name}".${validationWarning}${failureWarning}`,
        });
      } catch (err) {
        setAdminNotice({
          type: 'error',
          text: `CSV Import failed: ${err instanceof Error ? err.message : 'Unable to parse CSV file.'}`,
        });
      } finally {
        setIsImportingCsv(false);
        if (csvFileInputRef.current) {
          csvFileInputRef.current.value = '';
        }
      }
    },
    [currentUser.id, currentUser.name, importListingsBatch]
  );

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

  // Dynamic Field Form State
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
      (l) =>
        calculateListingCompleteness(l).score < 80 ||
        (l.category === 'real_estate' && !hasValidMandatoryPanorama(l))
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
      const res = changeListingStatus(
        listingId,
        targetStatus,
        decisionNotes[listingId] ||
          (action === 'Request Changes'
            ? 'Please review and complete all required fields and media.'
            : undefined)
      );

      if (isSupabaseConfigured()) {
        try {
          await supabase
            .from('listings')
            .update({
              status: targetStatus,
              updated_at: new Date().toISOString(),
            })
            .eq('id', listingId);
        } catch {
          if (targetListing) {
            void updateListing(
              listingId,
              { status: targetStatus },
              targetListing.ownerId
            ).catch(() => {
              // Local state already updated when Supabase is offline
            });
          }
        }
      } else if (targetListing) {
        void updateListing(
          listingId,
          { status: targetStatus },
          targetListing.ownerId
        ).catch(() => {
          // Local state already updated when Supabase is offline
        });
      }

      setRemotePendingListings((prev) =>
        prev.map((item) =>
          item.id === listingId ? { ...item, status: targetStatus } : item
        )
      );

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
          <select
            value={u.adminRole || ''}
            disabled={!canManageUsers}
            title={
              canManageUsers
                ? 'Assign administrator role'
                : 'Read-only: Only Super Administrator can change user roles'
            }
            onChange={(e) => {
              if (!canManageUsers) {
                setAdminNotice({
                  type: 'error',
                  text: `Permission denied: Role "${currentUser.adminRole}" cannot modify user roles.`,
                });
                return;
              }
              const val = e.target.value as AdminRole | '';
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
            className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <option value="">Non-Admin (Owner / Staff / Visitor)</option>
            {(Object.keys(ADMIN_ROLE_LABELS) as AdminRole[]).map((role) => (
              <option key={role} value={role}>
                {ADMIN_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
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
          <select
            value={r.status}
            disabled={!canManageListings}
            title={
              canManageListings
                ? 'Change listing status'
                : `Read-only for ${currentUser.adminRole}`
            }
            onChange={(e) => {
              const next = e.target.value as ListingStatus;
              const res = changeListingStatus(r.id, next);
              setAdminNotice({
                type: res.ok ? 'success' : 'error',
                text: res.message,
              });
            }}
            className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 text-xs font-semibold capitalize text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="pending_verification">Pending Verification</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
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
        header: '360° Rule Compliance',
        accessor: (r) =>
          r.category === 'real_estate'
            ? hasValidMandatoryPanorama(r)
              ? 'Compliant 360°'
              : 'Missing 360°'
            : 'N/A',
        render: (r) =>
          r.category === 'real_estate' ? (
            hasValidMandatoryPanorama(r) ? (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                ✓ {r.realEstateDetails?.panoramas.length}× 2:1 Equirectangular
              </span>
            ) : (
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                ✕ Missing 360° (Blocked from Publish)
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
      currentUser.adminRole,
      changeListingStatus,
      onOpenListingOnMap,
    ]
  );

  // Columns for Audit Logs
  const auditColumns = useMemo<DataColumn<AuditLogEntry>[]>(
    () => [
      {
        id: 'timestamp',
        header: 'Timestamp',
        accessor: (a) => a.timestamp,
        render: (a) => (
          <span className="font-mono text-xs text-[var(--ps-text-muted)]">
            {a.timestamp.replace('T', ' ').slice(0, 19)} UTC
          </span>
        ),
      },
      {
        id: 'actor',
        header: 'Actor & Role',
        accessor: (a) => `${a.actorName} (${a.actorRole})`,
      },
      {
        id: 'action',
        header: 'Action',
        accessor: (a) => a.action,
        render: (a) => (
          <span className="font-semibold text-[var(--ps-text)]">
            {a.action}
          </span>
        ),
      },
      {
        id: 'target',
        header: 'Target Entity',
        accessor: (a) => a.targetName || a.targetId || 'Platform',
      },
      {
        id: 'details',
        header: 'Audit Details',
        accessor: (a) => a.details,
      },
    ],
    []
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
    <div className="w-full max-w-7xl mx-auto overflow-x-hidden py-2 min-w-0">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 border-b border-[var(--ps-border)] pb-5 md:flex-row md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Administrator Command Centre
            </span>
            <span
              data-testid="admin-workspace-role-badge"
              className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-purple-700 dark:text-purple-300"
            >
              Role: {adminRoleDisplay.replace(/_/g, ' ')}
            </span>
            {isSuperAdminExclusive ? (
              <button
                type="button"
                data-testid="admin-live-mode-status-chip"
                onClick={() => setActiveTab('master_control')}
                title="Open Master Control"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
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
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]"
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
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[var(--ps-text)]">
            Hello {adminGreetingName} — Platform Governance, Verification &amp; Audit Controls
          </h1>
          <p className="mt-1 text-sm text-[var(--ps-text-muted)]">
            Supervise all {combinedListings.length} Churachandpur sample listings, 7-tier administrator roles, verification evidence, moderation queues, and non-cadastral boundary geometry.
          </p>
        </div>

        {/* Phase 14-B: CSV Import / Export Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
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
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] shadow-2xs transition hover:bg-[var(--ps-surface-alt)]"
          >
            <Download className="h-4 w-4 text-[var(--ps-accent)]" />
            Export to CSV
          </button>
          <button
            type="button"
            data-testid="admin-bulk-import-csv-btn"
            disabled={isImportingCsv || !canManageListings}
            onClick={() => csvFileInputRef.current?.click()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImportingCsv ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing CSV...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Bulk Import CSV
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

      {/* Navigation Tabs (Horizontally scrollable on mobile, wraps cleanly on desktop) */}
      <nav
        aria-label="Admin centre sections"
        className="mb-6 flex overflow-x-auto whitespace-nowrap lg:flex-wrap gap-1.5 border-b border-[var(--ps-border)] pb-3"
      >
        {[
          { id: 'command', label: 'Command Centre', icon: Layers },
          {
            id: 'users',
            label: `Users & 7 Admin Roles (${users.length})`,
            icon: Users,
          },
          {
            id: 'listings',
            label: `Listing Master (${listings.length})`,
            icon: Database,
          },
          {
            id: 'verification',
            label: `Verification Queue (${commandMetrics.pendingVerifications})`,
            icon: FileCheck2,
          },
          {
            id: 'moderation',
            label: `Moderation Queue (${commandMetrics.openModeration})`,
            icon: Flag,
          },
          ...(['admin', 'super_admin'].includes(
            String(adminRoleDisplay || '').toLowerCase()
          )
            ? [
                {
                  id: 'bulletins',
                  label: 'Bulletins & Plans',
                  icon: Newspaper,
                },
                {
                  id: 'pick_n_drop',
                  label: 'Pick N Drop & Fleet',
                  icon: Truck,
                },
              ]
            : []),
          {
            id: 'public_civic',
            label: 'Public & Civic',
            icon: Landmark,
          },
          ...(isSuperAdminExclusive
            ? [
                {
                  id: 'master_control',
                  label: 'Master Control',
                  icon: Crown,
                },
                {
                  id: 'payments_queue',
                  label: 'Payments Queue',
                  icon: CreditCard,
                },
                {
                  id: 'rates_plans',
                  label: 'Rates & Plans',
                  icon: Sliders,
                },
                {
                  id: 'system_audit',
                  label: 'System & Audit',
                  icon: Activity,
                },
              ]
            : []),
          { id: 'geographic', label: 'Geographic & Polygon QA', icon: MapPin },
          {
            id: 'dynamic_fields',
            label: 'Dynamic Categories & Fields',
            icon: Sliders,
          },
          {
            id: 'localization',
            label: 'Localization Manager',
            icon: Globe,
          },
          {
            id: 'settings',
            label: 'Platform & Commercial Demo',
            icon: Settings,
          },
          {
            id: 'audit',
            label: `Audit Logs (${auditLogs.length})`,
            icon: Activity,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AdminTab)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition shrink-0 ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                  : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* TAB 1: COMMAND CENTRE */}
      {activeTab === 'command' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(Object.keys(CATEGORY_LABELS) as ListingCategory[]).map((cat) => (
              <div
                key={cat}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
              >
                <div className="text-xs font-medium text-[var(--ps-text-muted)]">
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-[var(--ps-text)]">
                  {commandMetrics.byCategory[cat]}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                  Sample records in district
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Status Breakdown
              </h2>
              <div className="mt-3 space-y-2">
                {(Object.keys(commandMetrics.byStatus) as ListingStatus[]).map(
                  (st) => (
                    <div
                      key={st}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="capitalize text-[var(--ps-text-muted)]">
                        {st.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono font-bold text-[var(--ps-text)]">
                        {commandMetrics.byStatus[st]}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 lg:col-span-2">
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Governance & Compliance Alerts
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                  <div className="text-xs font-bold text-amber-800 dark:text-amber-200">
                    Pending Verification Requests (
                    {commandMetrics.pendingVerifications})
                  </div>
                  <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300">
                    Synthetic trade licences and ownership documents awaiting officer decision.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('verification')}
                    className="mt-2 text-xs font-bold text-amber-900 underline dark:text-amber-200"
                  >
                    Open Verification Centre →
                  </button>
                </div>

                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5">
                  <div className="text-xs font-bold text-rose-800 dark:text-rose-200">
                    Open Moderation Cases ({commandMetrics.openModeration})
                  </div>
                  <p className="mt-1 text-xs text-rose-800/80 dark:text-rose-300">
                    Flagged community reviews, boundary polygon overlap checks, and duplicate alerts.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('moderation')}
                    className="mt-2 text-xs font-bold text-rose-900 underline dark:text-rose-200"
                  >
                    Open Moderation Queue →
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Minimal Pending Verification Queue (status === 'pending') */}
          <section
            data-testid="admin-pending-verification-queue"
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-5 shadow-sm space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Pending Verification Queue ({verificationQueueListings.length})
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Approve to publish listings (<code>published</code>) or Reject to withhold (<code>rejected</code>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('verification')}
                className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
              >
                Full Queue View →
              </button>
            </div>

            {verificationQueueListings.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)] py-2">
                No listings currently have status <code>pending</code>.
              </p>
            ) : (
              <div className="divide-y divide-gray-200/70 dark:divide-gray-800/70">
                {verificationQueueListings.map((item) => (
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
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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
                        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ActivityFeed
            userId={authUser?.id}
            title="Admin Activity Feed"
            fallbackItems={auditLogs.slice(0, 8).map((entry) => ({
              id: entry.id,
              label: `${entry.action}${entry.targetName ? ` — ${entry.targetName}` : ''}`,
              timestamp: entry.timestamp,
            }))}
          />

          <SuperAdminGovernanceSection
            baseUsers={combinedUsers}
            listingsCount={combinedListings.length}
            sampleListingsCount={
              combinedListings.filter((item) => isSampleListing(item)).length
            }
            canManageUsers={canManageUsers}
            canManageSettings={canManageSettings}
            showSampleData={platformSettings.show_sample_data !== false}
            onUpdateLocalUserRole={(uid, updates) => {
              updateUserRoleOrStatus(uid, updates);
            }}
            onToggleSampleData={(enabled) => {
              updatePlatformSettings({ show_sample_data: enabled });
            }}
            onNotice={setAdminNotice}
          />
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          {isSuperAdminExclusive && (
            <SuperAdminUsersRolesSection onNotice={setAdminNotice} />
          )}
          <SuperAdminGovernanceSection
            baseUsers={combinedUsers}
            listingsCount={combinedListings.length}
            sampleListingsCount={
              combinedListings.filter((item) => isSampleListing(item)).length
            }
            canManageUsers={canManageUsers}
            canManageSettings={canManageSettings}
            showSampleData={platformSettings.show_sample_data !== false}
            onUpdateLocalUserRole={(uid, updates) => {
              updateUserRoleOrStatus(uid, updates);
            }}
            onToggleSampleData={(enabled) => {
              updatePlatformSettings({ show_sample_data: enabled });
            }}
            onNotice={setAdminNotice}
          />
          <DataTable
          title="User Accounts & 7-Tier Administrator Role Matrix"
          subtitle="Manage Visitor, Owner, Staff, and all 7 specialized Administrator roles (Super Admin, Listing Moderator, Verification Officer, Community Moderator, Customer Support, Finance/Commercial Admin, Analytics Viewer)."
          data={combinedUsers}
          columns={userColumns}
          rowKey={(u) => u.id}
          exportFilename="printswift-users-roles"
          bulkActions={
            canManageUsers
              ? [
                  {
                    label: 'Bulk Activate Users',
                    onClick: (ids) => {
                      ids.forEach((uid) => {
                        updateUserRoleOrStatus(uid, { status: 'active' });
                      });
                      setAdminNotice({
                        type: 'success',
                        text: `Activated ${ids.length} selected user account(s).`,
                      });
                    },
                  },
                  {
                    label: 'Bulk Suspend Users',
                    variant: 'danger',
                    onClick: (ids) => {
                      ids.forEach((uid) => {
                        updateUserRoleOrStatus(uid, { status: 'suspended' });
                      });
                      setAdminNotice({
                        type: 'info',
                        text: `Suspended ${ids.length} selected user account(s).`,
                      });
                    },
                  },
                ]
              : undefined
          }
        />
        </div>
      )}

      {/* TAB 3: LISTING MASTER ADMINISTRATION */}
      {activeTab === 'listings' && (
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
                    },
                  },
                  {
                    label: 'Bulk Request Changes',
                    onClick: (ids) => {
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
                    },
                  },
                  {
                    label: 'Bulk Suspend',
                    variant: 'danger',
                    onClick: (ids) => {
                      const res = bulkUpdateListingStatus(ids, 'suspended');
                      setAdminNotice({
                        type: res.permissionDenied ? 'error' : 'info',
                        text:
                          res.message || `Suspended ${res.updated} listings.`,
                      });
                    },
                  },
                ]
              : undefined
          }
        />
      )}

      {/* TAB 4: VERIFICATION CENTRE */}
      {activeTab === 'verification' && (
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

          <DataTable
            title={`Submitted Verification Requests (${verificationRequests.length})`}
            subtitle="Review ownership and trade verification evidence packages submitted by listing owners."
            data={verificationRequests}
            columns={verificationRequestColumns}
            rowKey={(req) => req.id}
            searchPlaceholder="Search verification requests..."
            exportFilename="printswift-verification-requests"
            emptyMessage="No verification evidence requests found."
            bulkActions={
              canManageVerification
                ? [
                    {
                      label: 'Bulk Approve Requests',
                      onClick: (ids) => {
                        ids.forEach((reqId) => {
                          decideVerificationRequest(
                            reqId,
                            'approved',
                            'Bulk approved by administrator.'
                          );
                        });
                        setAdminNotice({
                          type: 'success',
                          text: `Approved ${ids.length} verification request(s).`,
                        });
                      },
                    },
                    {
                      label: 'Bulk Reject Requests',
                      variant: 'danger',
                      onClick: (ids) => {
                        ids.forEach((reqId) => {
                          decideVerificationRequest(
                            reqId,
                            'rejected',
                            'Bulk rejected by administrator.'
                          );
                        });
                        setAdminNotice({
                          type: 'error',
                          text: `Rejected ${ids.length} verification request(s).`,
                        });
                      },
                    },
                  ]
                : undefined
            }
          />
        </div>
      )}

      {/* TAB 5: MODERATION CENTRE */}
      {activeTab === 'moderation' && (() => {
        const q = modSearch.trim().toLowerCase();
        const filteredModerationCases = moderationCases.filter((mc) => {
          if (modStatusFilter !== 'all' && mc.status !== modStatusFilter) {
            return false;
          }
          if (!q) return true;
          return (
            mc.targetTitle.toLowerCase().includes(q) ||
            mc.reason.toLowerCase().includes(q) ||
            mc.reportedBy.toLowerCase().includes(q) ||
            mc.targetType.toLowerCase().includes(q) ||
            mc.id.toLowerCase().includes(q)
          );
        });
        const hasModFilters = modSearch.trim() !== '' || modStatusFilter !== 'all';

        return (
          <div className="space-y-4 min-w-0">
            <WorkspaceTableToolbar
              searchQuery={modSearch}
              onSearchChange={setModSearch}
              searchPlaceholder="Search cases by title, reason, reporter…"
              filteredCount={filteredModerationCases.length}
              totalCount={moderationCases.length}
              countLabel="cases"
              hasActiveFilters={hasModFilters}
              onResetFilters={() => {
                setModSearch('');
                setModStatusFilter('all');
              }}
            >
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'open', label: 'Open' },
                    { id: 'resolved_kept', label: 'Kept' },
                    { id: 'resolved_actioned', label: 'Actioned' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setModStatusFilter(st.id)}
                    className={`inline-flex h-8 items-center rounded-lg px-2.5 text-[11px] font-semibold transition-colors ${
                      modStatusFilter === st.id
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </WorkspaceTableToolbar>

            {filteredModerationCases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2 text-xs text-[var(--ps-text-muted)]">
                <p className="font-semibold text-[var(--ps-text)]">
                  No moderation cases match your current filters
                </p>
                {hasModFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setModSearch('');
                      setModStatusFilter('all');
                    }}
                    className="inline-flex h-8 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <ResponsiveTableScroll
                minWidthClass="min-w-[540px]"
                wrapperClassName="border-none bg-transparent shadow-none"
                swipeHintLabel="Swipe ↔ to inspect moderation actions"
              >
                <div className="space-y-4">
                  {filteredModerationCases.map((mc) => (
                    <div
                      key={mc.id}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-600">
                            Target: {mc.targetType}
                          </span>
                          <h3 className="mt-1 text-base font-bold text-[var(--ps-text)]">
                            {mc.targetTitle}
                          </h3>
                          <p className="text-xs text-[var(--ps-text-muted)]">
                            Reason: <strong>{mc.reason}</strong> • Reported by{' '}
                            {mc.reportedBy}
                          </p>
                        </div>
                        <span className="rounded border border-[var(--ps-border)] px-2.5 py-1 text-xs font-bold uppercase">
                          {mc.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          disabled={!canManageModeration}
                          value={decisionNotes[mc.id] || mc.decisionNote || ''}
                          onChange={(e) =>
                            setDecisionNotes({
                              ...decisionNotes,
                              [mc.id]: e.target.value,
                            })
                          }
                          placeholder="Enter moderation decision note..."
                          className="flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-55"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={!canManageModeration}
                            onClick={() => {
                              if (!canManageModeration) return;
                              decideModerationCase(
                                mc.id,
                                'resolved_kept',
                                decisionNotes[mc.id] || 'Reviewed and kept visible.'
                              );
                              setAdminNotice({
                                type: 'info',
                                text: `Resolved case ${mc.id} (Content Kept).`,
                              });
                            }}
                            className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Keep Content
                          </button>
                          <button
                            type="button"
                            disabled={!canManageModeration}
                            onClick={() => {
                              if (!canManageModeration) return;
                              decideModerationCase(
                                mc.id,
                                'resolved_actioned',
                                decisionNotes[mc.id] ||
                                  'Content hidden / actioned per moderation policy.'
                              );
                              setAdminNotice({
                                type: 'success',
                                text: `Resolved case ${mc.id} (Action Taken).`,
                              });
                            }}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Hide / Action Content
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ResponsiveTableScroll>
            )}
          </div>
        );
      })()}

      {/* TAB 6: GEOGRAPHIC & POLYGON QA */}
      {activeTab === 'geographic' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Pin Coordinate & Locality Correction Tool
            </h2>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Adjust map pin coordinates and locality assignment for any listing in Churachandpur district.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Select Listing
                </label>
                <select
                  value={selectedGeoListing?.id || ''}
                  onChange={(e) => {
                    const found = listings.find((l) => l.id === e.target.value);
                    setEditingGeoListingId(e.target.value);
                    if (found) {
                      setGeoLatInput(String(found.coordinates.lat));
                      setGeoLngInput(String(found.coordinates.lng));
                      setGeoLocalityInput(found.locality);
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs font-semibold text-[var(--ps-text)]"
                >
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} ({l.locality})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={geoLatInput}
                    onChange={(e) => setGeoLatInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-xs text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={geoLngInput}
                    onChange={(e) => setGeoLngInput(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono text-xs text-[var(--ps-text)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Assigned Locality
                </label>
                <input
                  type="text"
                  value={geoLocalityInput}
                  onChange={(e) => setGeoLocalityInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!canManageGeography}
                  onClick={() => {
                    if (!selectedGeoListing) return;
                    const res = updateListingCoordinates(
                      selectedGeoListing.id,
                      {
                        lat: parseFloat(geoLatInput) || 24.3335,
                        lng: parseFloat(geoLngInput) || 93.6978,
                      },
                      geoLocalityInput
                    );
                    setAdminNotice({
                      type: res.ok ? 'success' : 'error',
                      text: res.ok
                        ? `Updated coordinates for "${selectedGeoListing.title}".`
                        : res.message,
                    });
                  }}
                  className="rounded-lg bg-[var(--ps-accent)] px-4 py-2 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Pin Coordinates
                </button>
                {selectedGeoListing && (
                  <button
                    type="button"
                    onClick={() => onOpenListingOnMap(selectedGeoListing.id)}
                    className="rounded-lg border border-[var(--ps-border)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)]"
                  >
                    Inspect on Discovery Map
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Illustrative Real-Estate Polygon Geometry QA
            </h2>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Verifies vertex counts and canonical m² area for land-bearing real-estate listings (Plot, House with Plot, Villa, Commercial with Plot).
            </p>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {listings
                .filter(
                  (l) =>
                    l.category === 'real_estate' &&
                    l.realEstateDetails?.boundaryPolygon &&
                    l.realEstateDetails.boundaryPolygon.length >= 3
                )
                .map((l) => {
                  const poly = l.realEstateDetails!.boundaryPolygon!;
                  const metrics = calculatePolygonMetrics(poly);
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs"
                    >
                      <div>
                        <div className="font-bold text-[var(--ps-text)]">
                          {l.title}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--ps-text-muted)]">
                          {poly.length} vertices • Computed Area:{' '}
                          {formatAreaValue(metrics.areaSqm, areaUnit)} •
                          Perimeter: {Math.round(metrics.perimeterMeters)} m
                        </div>
                      </div>
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                        Valid Ring
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: DYNAMIC CATEGORIES & FIELDS */}
      {activeTab === 'dynamic_fields' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Add Dynamic Category Field
            </h2>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Custom fields immediately appear in the Listing Editor and Public Detail View. Note: Core platform rules (such as the compulsory real-estate 360° panorama rule) are locked and cannot be disabled.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Target Category
                </label>
                <select
                  value={newFieldCategory}
                  onChange={(e) =>
                    setNewFieldCategory(e.target.value as ListingCategory)
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                >
                  {(Object.keys(CATEGORY_LABELS) as ListingCategory[]).map(
                    (c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Field Label
                </label>
                <input
                  type="text"
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  placeholder="e.g., Rainwater Harvesting Installed"
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--ps-text-muted)]">
                  Field Type
                </label>
                <select
                  value={newFieldType}
                  onChange={(e) =>
                    setNewFieldType(
                      e.target.value as DynamicFieldDefinition['fieldType']
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)]"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Yes / No</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--ps-text)]">
                <input
                  type="checkbox"
                  checked={newFieldRequired}
                  onChange={(e) => setNewFieldRequired(e.target.checked)}
                />
                Mark as recommended in completeness check
              </label>

              <button
                type="button"
                disabled={!canManageSchema}
                onClick={() => {
                  if (!canManageSchema) return;
                  if (!newFieldLabel.trim()) return;
                  saveDynamicField({
                    id: `df-${Date.now()}`,
                    category: newFieldCategory,
                    label: newFieldLabel.trim(),
                    name: newFieldLabel
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '_'),
                    fieldType: newFieldType,
                    required: newFieldRequired,
                    publicVisible: true,
                    ownerEditable: true,
                    adminOnly: false,
                    filterable: true,
                  });
                  setNewFieldLabel('');
                  setAdminNotice({
                    type: 'success',
                    text: 'Added custom category field.',
                  });
                }}
                className="w-full rounded-lg bg-[var(--ps-accent)] py-2 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Dynamic Field
              </button>
            </div>
          </div>

          <div className="space-y-3 lg:col-span-2">
            {dynamicFields.map((df) => (
              <div
                key={df.id}
                className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
              >
                <div>
                  <span className="rounded bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                    {CATEGORY_LABELS[df.category]}
                  </span>
                  <h3 className="mt-1 text-sm font-bold text-[var(--ps-text)]">
                    {df.label}{' '}
                    <span className="font-mono text-xs font-normal text-[var(--ps-text-muted)]">
                      ({df.name} • {df.fieldType})
                    </span>
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={!canManageSchema}
                  onClick={() => deleteDynamicField(df.id)}
                  className="rounded border border-rose-500/30 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 8: LOCALIZATION MANAGER (OVER-THE-AIR I18N) */}
      {activeTab === 'localization' && (
        <LocalizationManagerSection
          canManageTranslations={
            canManageSettings || adminRoleDisplay === 'super_admin'
          }
          onNotice={setAdminNotice}
        />
      )}

      {/* TAB 9: PLATFORM SETTINGS, COMMERCIAL DEMO & PRIVACY */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Platform Governance & Privacy Retention Controls
            </h2>
            <div className="mt-4 space-y-4 text-xs">
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div>
                  <div className="font-bold text-emerald-900 dark:text-emerald-200">
                    Compulsory Real-Estate 360° Panorama Rule
                  </div>
                  <div className="text-emerald-800/80 dark:text-emerald-300">
                    Locked by architecture: Every published real-estate listing must include at least one valid 2:1 equirectangular panorama.
                  </div>
                </div>
                <span className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
                  ENFORCED
                </span>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                <div>
                  <div className="font-bold text-[var(--ps-text)]">
                    Show [SAMPLE] Demo Listings on Public Map (show_sample_data)
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    Instantly disable or hide all [SAMPLE] demo listings from the public discovery map.
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="settings-show-sample-data-checkbox"
                  disabled={!canManageSettings}
                  checked={platformSettings.show_sample_data !== false}
                  onChange={(e) => {
                    const nextVal = e.target.checked;
                    updatePlatformSettings({
                      show_sample_data: nextVal,
                    });
                    void updateAppSetting('show_sample_data', nextVal);
                    setAdminNotice({
                      type: 'success',
                      text: nextVal
                        ? 'Enabled show_sample_data: [SAMPLE] demo listings are visible on the public map.'
                        : 'Disabled show_sample_data: Hidden all [SAMPLE] demo listings from the public map.',
                    });
                  }}
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] p-3">
                <span>Enable Public Demonstration Enquiries</span>
                <input
                  type="checkbox"
                  disabled={!canManageSettings}
                  checked={platformSettings.enablePublicEnquiries}
                  onChange={(e) =>
                    updatePlatformSettings({
                      enablePublicEnquiries: e.target.checked,
                    })
                  }
                />
              </label>

              <label className="flex items-center justify-between rounded-lg border border-[var(--ps-border)] p-3">
                <span>Enable Public Sample Reviews</span>
                <input
                  type="checkbox"
                  disabled={!canManageSettings}
                  checked={platformSettings.enablePublicReviews}
                  onChange={(e) =>
                    updatePlatformSettings({
                      enablePublicReviews: e.target.checked,
                    })
                  }
                />
              </label>

              <div>
                <label className="block font-semibold text-[var(--ps-text-muted)]">
                  Local Prototype Log Retention Window (Days)
                </label>
                <input
                  type="number"
                  disabled={!canManageSettings}
                  value={platformSettings.dataRetentionDays}
                  onChange={(e) =>
                    updatePlatformSettings({
                      dataRetentionDays: parseInt(e.target.value, 10) || 90,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 font-mono disabled:cursor-not-allowed disabled:opacity-55"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                Commercial & Sponsored Placement Demo
              </h2>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                SIMULATED COMMERCIAL PLAN — NO REAL BILLING
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Demonstrates how featured and sponsored directory placements are administered without real payment processing.
            </p>
            <div className="mt-4 space-y-3">
              {[
                {
                  tier: 'Standard Community Listing',
                  price: '₹0 / Free Prototype Tier',
                  features:
                    'Map pin, full category page, product catalogue or 360° property tour, enquiry inbox.',
                },
                {
                  tier: 'Featured District Spotlight (Demo)',
                  price: '₹999 / month (Simulated)',
                  features:
                    'Highlighted badge in viewport list, priority placement in category filter, analytics export.',
                },
              ].map((plan) => (
                <div
                  key={plan.tier}
                  className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--ps-text)]">
                      {plan.tier}
                    </span>
                    <span className="font-mono text-xs font-bold text-[var(--ps-accent)]">
                      {plan.price}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                    {plan.features}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: BULLETINS & SUBSCRIPTION PLANS (Strictly gated to admin / super_admin) */}
      {activeTab === 'bulletins' &&
        ['admin', 'super_admin'].includes(
          String(adminRoleDisplay || '').toLowerCase()
        ) && (
          <AdminBulletinManager
            fallbackUsers={users}
            onNotice={setAdminNotice}
          />
        )}

      {/* TAB: PICK N DROP ESCROW, DISPATCH & FLEET CONSOLE */}
      {activeTab === 'pick_n_drop' &&
        ['admin', 'super_admin'].includes(
          String(adminRoleDisplay || '').toLowerCase()
        ) && <PickNDropConsole onNotice={setAdminNotice} />}

      {/* TAB: PUBLIC & CIVIC SERVICES DESK (Authorized Civic Staff / Admins / Super-Admin) */}
      {activeTab === 'public_civic' && (
        <CivicDirectoryManager
          hubs={hubs}
          hubId={activeHub?.id}
          isSuperAdmin={isSuperAdminExclusive}
          onNotice={setAdminNotice}
        />
      )}

      {/* SUPER-ADMIN EXCLUSIVE: MASTER CONTROL CONSOLE */}
      {activeTab === 'master_control' && isSuperAdminExclusive && (
        <MasterControlConsole onNotice={setAdminNotice} />
      )}

      {/* SUPER-ADMIN EXCLUSIVE: UNIFIED PAYMENTS QUEUE */}
      {activeTab === 'payments_queue' && isSuperAdminExclusive && (
        <UnifiedPaymentsQueue onNotice={setAdminNotice} />
      )}

      {/* SUPER-ADMIN EXCLUSIVE: LIVE VEHICLE RATES & SUBSCRIPTION PLANS */}
      {activeTab === 'rates_plans' && isSuperAdminExclusive && (
        <SuperAdminRatesPlansSection onNotice={setAdminNotice} />
      )}

      {/* SUPER-ADMIN EXCLUSIVE: SYSTEM AUDIT & 48H POD PURGE */}
      {activeTab === 'system_audit' && isSuperAdminExclusive && (
        <SuperAdminSystemAuditSection onNotice={setAdminNotice} />
      )}

      {/* TAB 9: SYSTEM MONITORING & AUDIT LOGS */}
      {activeTab === 'audit' && (
        <DataTable
          title="System Monitoring & Immutable Audit Log"
          subtitle="Tracks every listing edit, status change, verification decision, moderation action, role assignment, and spreadsheet import/export in the prototype."
          data={auditLogs}
          columns={auditColumns}
          rowKey={(a) => a.id}
          exportFilename="printswift-system-audit-log"
        />
      )}

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
    </div>
  );
}
