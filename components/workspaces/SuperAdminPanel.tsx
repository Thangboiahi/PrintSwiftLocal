'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  EyeOff,
  Loader2,
  Lock,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { MasterControlConsole } from '@/components/workspaces/MasterControlConsole';
import { MediatorDeskRedirectCard } from '@/components/workspaces/shared/MediatorDeskRedirectCard';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { updateAppSetting } from '@/lib/supabase/admin';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchHideSampleDataFlag,
  updateHideSampleDataFlag,
} from '@/lib/supabase/platform-settings';
import type {
  DeliveryServiceMode,
  VehicleTypeItem,
} from '@/lib/pick-n-drop/types';

// `super_admin` is immutable via client UI/API (DB trigger enforced)
const ROLE_OPTIONS: CustomSelectOption[] = [
  { value: 'visitor', label: 'Visitor', description: 'Standard public user' },
  {
    value: 'driver',
    label: 'Driver',
    description: 'Pick N Drop fleet & OTP handover access',
  },
  {
    value: 'staff',
    label: 'Staff',
    description: 'Delegated shop listings & stock access',
  },
  {
    value: 'owner',
    label: 'Owner',
    description: 'Listings, Marketplace, Bulletins & Mediator',
  },
  {
    value: 'hub_manager',
    label: 'Hub Manager',
    description: 'Hub-scoped listings, rates & partner moderation',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Moderation, Bulletins, Fleet & Escrow',
  },
];

const ALL_SERVICE_MODES: { id: DeliveryServiceMode; label: string }[] = [
  { id: 'parcel', label: 'Parcel' },
  { id: 'passenger', label: 'Ride' },
  { id: 'gas', label: 'LPG Gas' },
];

interface ProfileUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  name: string | null;
  role: string;
  phone: string | null;
  created_at: string | null;
}

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  max_active_bulletins: number;
  max_monthly_posts: number;
  max_images_per_post: number;
  allow_youtube: boolean;
  duration_days: number;
  is_active: boolean;
}

interface BulletinAuditLogRow {
  id: string;
  bulletin_id: string | null;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface DeliveryEventRow {
  id: string;
  order_id: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface SuperAdminSectionNoticeProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

// =============================================================================
// 1. SUPER-ADMIN USERS & ROLES MANAGER (superadmin_set_user_role RPC)
// =============================================================================
export function SuperAdminUsersRolesSection({
  onNotice,
}: SuperAdminSectionNoticeProps) {
  const [users, setUsers] = useState<ProfileUserRow[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();

  const loadUsers = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, name, role, phone, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      setUsers((data || []) as ProfileUserRow[]);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load profiles.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadUsers();
    });
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && (u.role || 'visitor') !== roleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (u.full_name || u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter]);

  const handleAssignRole = async (userRow: ProfileUserRow, nextRole: string) => {
    if (
      userRow.role === 'super_admin' ||
      nextRole === 'super_admin' ||
      nextRole === userRow.role
    ) {
      return;
    }

    const roleRank: Record<string, number> = {
      visitor: 0,
      staff: 1,
      driver: 2,
      owner: 3,
      hub_manager: 4,
      admin: 5,
    };
    const isDemotion =
      (roleRank[nextRole] ?? 0) < (roleRank[userRow.role || 'visitor'] ?? 0);
    const label = userRow.full_name || userRow.email || userRow.id;

    const ok = await confirm({
      title: isDemotion
        ? `Revoke / Demote Role for ${label}?`
        : `Grant "${nextRole.replace(/_/g, ' ')}" Role to ${label}?`,
      description: `Change platform role from "${userRow.role || 'visitor'}" to "${nextRole}" via audited superadmin_set_user_role RPC.`,
      caution: isDemotion
        ? 'Reducing privileges immediately revokes workspace access for this account on next session check.'
        : 'Elevated roles grant immediate operational privileges across assigned workspaces.',
      impactSummary: [
        `Account: ${label} (${userRow.email || userRow.id.slice(0, 8)})`,
        `Role transition: ${userRow.role || 'visitor'} → ${nextRole}`,
        'Logged automatically to immutable public.audit_logs.',
      ],
      confirmLabel: isDemotion ? 'Confirm Role Revocation' : 'Confirm Role Grant',
      variant: isDemotion ? 'danger' : 'warning',
    });
    if (!ok) return;

    setSavingUserId(userRow.id);
    setAppStatus('saving', 'Updating user role…');
    try {
      const { error } = await supabase.rpc('superadmin_set_user_role', {
        p_target_user_id: userRow.id,
        p_new_role: nextRole,
      });
      if (error) throw new Error(error.message);

      setUsers((prev) =>
        prev.map((u) => (u.id === userRow.id ? { ...u, role: nextRole } : u))
      );
      const label = userRow.full_name || userRow.email || userRow.id;
      const msg = `Assigned "${nextRole}" to ${label}.`;
      setFeedback({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Role updated');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update user role.';
      setFeedback({ type: 'error', text: msg });
      onNotice?.({ type: 'error', text: msg });
      setAppStatus('error', 'Role update failed');
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Super-Admin Role Governance ({users.length})
            </h2>
          </div>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Search accounts and assign roles (Visitor, Driver, Staff, Owner, Hub
            Manager, Admin) via audited RPC. Super Admin accounts are strictly
            immutable and locked read-only.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Toolbar: Live Search, Role Filters, Counts, Reset */}
      <WorkspaceTableToolbar
        searchQuery={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, email, phone, role or ID…"
        filteredCount={filteredUsers.length}
        totalCount={users.length}
        countLabel="users"
        hasActiveFilters={Boolean(search || roleFilter !== 'all')}
        onResetFilters={() => {
          setSearch('');
          setRoleFilter('all');
        }}
        actions={
          <button
            type="button"
            onClick={() => void loadUsers()}
            aria-label="Refresh users"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {[
            { id: 'all', label: 'All Roles' },
            { id: 'super_admin', label: 'Super Admin' },
            { id: 'admin', label: 'Admin' },
            { id: 'hub_manager', label: 'Hub Manager' },
            { id: 'owner', label: 'Owner' },
            { id: 'driver', label: 'Driver' },
            { id: 'staff', label: 'Staff' },
            { id: 'visitor', label: 'Visitor' },
          ].map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleFilter(r.id)}
              className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                roleFilter === r.id
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </WorkspaceTableToolbar>

      {isLoading ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading user profiles">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
            >
              <div className="space-y-2 flex-1">
                <div className="dd-shimmer h-3.5 w-40 rounded-md" />
                <div className="dd-shimmer h-3 w-56 rounded-md" />
              </div>
              <div className="dd-shimmer h-9 w-36 rounded-lg" />
            </div>
          ))}
        </div>
      ) : filteredUsers.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
          No matching user profiles found for current filters.
        </p>
      ) : (
        <>
          {/* Mobile (<md) stacked cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-xs text-[var(--ps-text)] truncate">
                      {u.full_name || u.name || 'Unnamed User'}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                      {u.email || 'No email registered'}
                      {u.phone ? ` • ${u.phone}` : ''}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--ps-text-muted)]">
                      {u.id.slice(0, 8)}…{u.id.slice(-4)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text)]">
                    {u.role || 'visitor'}
                  </span>
                </div>

                {u.role === 'super_admin' ? (
                  <div
                    data-testid={`superadmin-role-locked-mobile-${u.id}`}
                    title="Managed via SQL migration only"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-bold text-rose-700 dark:text-rose-300"
                  >
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>Super Admin · Managed via SQL migration only</span>
                  </div>
                ) : savingUserId === u.id ? (
                  <div className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs text-[var(--ps-text-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving role…
                  </div>
                ) : (
                  <CustomSelectModal
                    placeholder="Select role"
                    options={ROLE_OPTIONS}
                    value={u.role || 'visitor'}
                    onChange={(val) => void handleAssignRole(u, val)}
                    className="[&>button]:min-h-[44px]"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Tablet / Desktop table */}
          <div className="hidden md:block">
        <ResponsiveTableScroll
          minWidthClass="min-w-[640px]"
          showSwipeHint={true}
          swipeHintLabel="Swipe ↔ to view user roles and actions"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2.5 px-3 whitespace-nowrap">User Account</th>
                <th className="py-2.5 px-3 whitespace-nowrap">User ID</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Current Role</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">Assign Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]">
              {filteredUsers.map((u) => (
                <tr
                  key={u.id}
                  className="hover:bg-[var(--ps-surface-alt)]/40 transition-colors"
                >
                  <td className="py-2.5 px-3">
                    <p className="font-bold text-[var(--ps-text)] truncate">
                      {u.full_name || u.name || 'Unnamed User'}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                      {u.email || 'No email registered'}
                      {u.phone ? ` • ${u.phone}` : ''}
                    </p>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[10px] text-[var(--ps-text-muted)] whitespace-nowrap">
                    {u.id.slice(0, 8)}…{u.id.slice(-4)}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                        u.role === 'super_admin'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                          : u.role === 'admin'
                            ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30'
                            : u.role === 'hub_manager'
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30'
                              : u.role === 'owner'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                                : u.role === 'driver'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-100 dark:bg-slate-800 text-[var(--ps-text-muted)] border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {u.role || 'visitor'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    {u.role === 'super_admin' ? (
                      <span
                        data-testid={`superadmin-role-locked-${u.id}`}
                        title="Managed via SQL migration only"
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-700 dark:text-rose-300 select-none"
                      >
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        <span>Read-Only · Locked</span>
                      </span>
                    ) : (
                      <div className="inline-block w-48 text-left">
                        {savingUserId === u.id ? (
                          <div className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px] text-[var(--ps-text-muted)]">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Saving…
                          </div>
                        ) : (
                          <CustomSelectModal
                            placeholder="Select role"
                            options={ROLE_OPTIONS}
                            value={u.role || 'visitor'}
                            onChange={(val) => void handleAssignRole(u, val)}
                            testId={`superadmin-role-select-${u.id}`}
                            className="[&>button]:min-h-[44px]"
                          />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableScroll>
          </div>
        </>
      )}
      {confirmDialog}
    </section>
  );
}

// =============================================================================
// 2. SUPER-ADMIN RATES & PLANS LIVE EDITOR
// =============================================================================
export function SuperAdminRatesPlansSection({
  onNotice,
}: SuperAdminSectionNoticeProps) {
  const [vehicles, setVehicles] = useState<VehicleTypeItem[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const { confirm: confirmRates, dialog: ratesConfirmDialog } =
    useConfirmDialogState();

  const loadRatesAndPlans = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [vtRes, plansRes] = await Promise.all([
        supabase
          .from('vehicle_types')
          .select('*')
          .order('base_fare_inr', { ascending: true }),
        supabase
          .rpc('superadmin_list_subscription_plans')
          .order('price_inr', { ascending: true }),
      ]);

      setVehicles(
        ((vtRes.data || []) as VehicleTypeItem[]).map((v) => ({
          ...v,
          base_fare_inr: Number(v.base_fare_inr),
          per_km_rate_inr: Number(v.per_km_rate_inr),
          wait_per_10min_inr: Number(v.wait_per_10min_inr),
          two_way_multiplier: Number(v.two_way_multiplier || 1.7),
          max_weight_kg: Number(v.max_weight_kg || 25),
          supported_modes: Array.isArray(v.supported_modes)
            ? v.supported_modes
            : ['parcel'],
        }))
      );
      setPlans(
        ((plansRes.data || []) as SubscriptionPlanRow[]).map((p) => ({
          ...p,
          price_inr: Number(p.price_inr),
          max_active_bulletins: Number(p.max_active_bulletins),
          max_monthly_posts: Number(p.max_monthly_posts),
          max_images_per_post: Number(p.max_images_per_post),
        }))
      );
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load rate cards.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRatesAndPlans();
    });
  }, [loadRatesAndPlans]);

  const updateVehicleDraft = (
    id: string,
    patch: Partial<VehicleTypeItem>
  ) => {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...patch } : v))
    );
  };

  const toggleVehicleMode = (
    vehicle: VehicleTypeItem,
    mode: DeliveryServiceMode
  ) => {
    const current = Array.isArray(vehicle.supported_modes)
      ? vehicle.supported_modes
      : [];
    const exists = current.includes(mode);
    const next = exists
      ? current.filter((m) => m !== mode)
      : [...current, mode];
    if (next.length === 0) return;
    updateVehicleDraft(vehicle.id, { supported_modes: next });
  };

  const handleSaveVehicle = async (vehicle: VehicleTypeItem) => {
    const ok = await confirmRates({
      title: `Update Rate Card for ${vehicle.name}?`,
      description:
        'Live Pick N Drop fare quotes and homepage previews will immediately reflect these updated rates.',
      impactSummary: [
        `Base Fare: ₹${vehicle.base_fare_inr} · Per-km: ₹${vehicle.per_km_rate_inr}`,
        `Two-Way Multiplier: ${vehicle.two_way_multiplier}x · Max Weight: ${vehicle.max_weight_kg} kg`,
        `Status: ${vehicle.is_active ? 'Active' : 'Inactive'}`,
      ],
      confirmLabel: 'Save Rate Card',
      variant: 'warning',
    });
    if (!ok) return;

    setSavingId(vehicle.id);
    setAppStatus('saving', `Saving ${vehicle.name} rates…`);
    try {
      const { error } = await supabase
        .from('vehicle_types')
        .update({
          base_fare_inr: Number(vehicle.base_fare_inr),
          per_km_rate_inr: Number(vehicle.per_km_rate_inr),
          two_way_multiplier: Number(vehicle.two_way_multiplier),
          max_weight_kg: Number(vehicle.max_weight_kg),
          supported_modes: vehicle.supported_modes,
          is_active: vehicle.is_active,
        })
        .eq('id', vehicle.id);
      if (error) throw new Error(error.message);

      const msg = `Updated rate card for ${vehicle.name}.`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Vehicle rate saved');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save vehicle rate.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Rate save failed');
    } finally {
      setSavingId(null);
    }
  };

  const updatePlanDraft = (
    id: string,
    patch: Partial<SubscriptionPlanRow>
  ) => {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const handleSavePlan = async (plan: SubscriptionPlanRow) => {
    const ok = await confirmRates({
      title: `Update Bulletin Plan "${plan.name}"?`,
      description:
        'Updates pricing and database-enforced bulletin quotas immediately for active subscribers.',
      impactSummary: [
        `Price: ₹${plan.price_inr} · Active Limit: ${plan.max_active_bulletins}`,
        `Monthly Posts: ${plan.max_monthly_posts} · Max Images: ${plan.max_images_per_post}`,
      ],
      confirmLabel: 'Save Plan',
      variant: 'warning',
    });
    if (!ok) return;

    setSavingId(plan.id);
    setAppStatus('saving', `Saving ${plan.name} plan…`);
    try {
      const { error } = await supabase
        .from('subscription_plans')
        .update({
          price_inr: Number(plan.price_inr),
          max_active_bulletins: Number(plan.max_active_bulletins),
          max_monthly_posts: Number(plan.max_monthly_posts),
          max_images_per_post: Number(plan.max_images_per_post),
          is_active: plan.is_active,
        })
        .eq('id', plan.id);
      if (error) throw new Error(error.message);

      const msg = `Updated Bulletin plan "${plan.name}".`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Plan updated');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save subscription plan.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Plan save failed');
    } finally {
      setSavingId(null);
    }
  };

  if (isLoading) {
    return (
      <div
        className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
        aria-busy="true"
        aria-label="Loading vehicle rate cards and subscription plans"
      >
        <div className="dd-shimmer h-5 w-56 rounded-md" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5"
            >
              <div className="dd-shimmer h-4 w-36 rounded-md" />
              <div className="grid grid-cols-2 gap-2">
                <div className="dd-shimmer h-9 rounded-lg" />
                <div className="dd-shimmer h-9 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {banner && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {banner.type === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Vehicle Types Rate Card Editor */}
      <section className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
              <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>Pick N Drop Vehicle Rate Cards ({vehicles.length})</span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Changes take effect immediately across homepage previews and
              server-side fare quotes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRatesAndPlans()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]"
            aria-label="Reload rates"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {vehicles.map((v) => (
            <div
              key={v.id}
              className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[var(--ps-text)]">
                    {v.name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                    {v.slug}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateVehicleDraft(v.id, { is_active: !v.is_active })
                    }
                    className={`h-7 rounded-md border px-2 text-[10px] font-bold ${
                      v.is_active
                        ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-400/40 bg-slate-500/10 text-slate-500'
                    }`}
                  >
                    {v.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    type="button"
                    disabled={savingId === v.id}
                    onClick={() => void handleSaveVehicle(v)}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--ps-accent)] px-2.5 text-[11px] font-bold text-[var(--ps-accent-fg)] disabled:opacity-60"
                  >
                    {savingId === v.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Base Fare (₹)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={v.base_fare_inr}
                    onChange={(e) =>
                      updateVehicleDraft(v.id, {
                        base_fare_inr: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Per-Km Rate (₹)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={v.per_km_rate_inr}
                    onChange={(e) =>
                      updateVehicleDraft(v.id, {
                        per_km_rate_inr: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Two-Way Mult.
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    step="0.05"
                    value={v.two_way_multiplier}
                    onChange={(e) =>
                      updateVehicleDraft(v.id, {
                        two_way_multiplier: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Max Weight (kg)
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={v.max_weight_kg}
                    onChange={(e) =>
                      updateVehicleDraft(v.id, {
                        max_weight_kg: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] font-semibold text-[var(--ps-text-muted)] mr-1">
                  Supported Modes:
                </span>
                {ALL_SERVICE_MODES.map((m) => {
                  const active = v.supported_modes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleVehicleMode(v, m.id)}
                      className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition-colors ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription Plans Editor */}
      <section className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
            <Crown className="h-4 w-4 text-amber-500" />
            <span>Bulletin Subscription Plans ({plans.length})</span>
          </h2>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Adjust pricing and database-enforced bulletin quotas live.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.id}
              className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-[var(--ps-text)]">{p.name}</p>
                  <p className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                    {p.slug}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingId === p.id}
                  onClick={() => void handleSavePlan(p)}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--ps-accent)] px-2.5 text-[11px] font-bold text-[var(--ps-accent-fg)] disabled:opacity-60"
                >
                  {savingId === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  <span>Save</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Price (₹)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={p.price_inr}
                    onChange={(e) =>
                      updatePlanDraft(p.id, {
                        price_inr: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Max Active
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={p.max_active_bulletins}
                    onChange={(e) =>
                      updatePlanDraft(p.id, {
                        max_active_bulletins: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Max Monthly
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={p.max_monthly_posts}
                    onChange={(e) =>
                      updatePlanDraft(p.id, {
                        max_monthly_posts: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Max Images
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={p.max_images_per_post}
                    onChange={(e) =>
                      updatePlanDraft(p.id, {
                        max_images_per_post: Number(e.target.value),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>
      {ratesConfirmDialog}
    </div>
  );
}

// =============================================================================
// 3. SUPER-ADMIN SYSTEM & AUDIT FEED + 48H POD PURGE TRIGGER
// =============================================================================
export function SuperAdminSystemAuditSection({
  onNotice,
}: SuperAdminSectionNoticeProps) {
  const { user: authUser } = useAuth();
  const [bulletinLogs, setBulletinLogs] = useState<BulletinAuditLogRow[]>([]);
  const [deliveryEvents, setDeliveryEvents] = useState<DeliveryEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurging, setIsPurging] = useState(false);
  const [hideSampleData, setHideSampleData] = useState(false);
  const [isTogglingSample, setIsTogglingSample] = useState(false);
  const [purgeBanner, setPurgeBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [queueCounts, setQueueCounts] = useState<{
    pendingListings: number;
    pendingPartnerApps: number;
    pendingBulletins: number;
    escrowDisputes: number;
  } | null>(null);
  const [podChecklist, setPodChecklist] = useState<{
    bucketPrivateRls: boolean;
    pgCronScheduled: boolean;
    retention48hVerified: boolean;
  }>({
    bucketPrivateRls: true,
    pgCronScheduled: false,
    retention48hVerified: false,
  });
  const { confirm: confirmSystem, dialog: systemConfirmDialog } =
    useConfirmDialogState();

  const demoAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true';

  const loadAuditFeeds = useCallback(async () => {
    setIsLoading(true);
    try {
      const sampleFlag = await fetchHideSampleDataFlag(true);
      setHideSampleData(sampleFlag);

      if (!isSupabaseConfigured()) {
        return;
      }

      const [
        bulRes,
        delRes,
        listingsPendingRes,
        partnerPendingRes,
        bulletinsPendingRes,
        escrowPendingRes,
      ] = await Promise.all([
        supabase
          .from('bulletin_audit_logs')
          .select('id, bulletin_id, actor_id, action, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('delivery_order_events')
          .select('id, order_id, actor_id, event_type, payload, created_at')
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .in('status', [
            'pending',
            'pending_verification',
            'submitted',
            'changes_requested',
          ]),
        supabase
          .from('partner_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('bulletins')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'flagged', 'reported']),
        supabase
          .from('delivery_orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['disputed', 'awaiting_mediator_verification']),
      ]);
      setBulletinLogs((bulRes.data || []) as BulletinAuditLogRow[]);
      setDeliveryEvents((delRes.data || []) as DeliveryEventRow[]);
      setQueueCounts({
        pendingListings: listingsPendingRes.count ?? 0,
        pendingPartnerApps: partnerPendingRes.count ?? 0,
        pendingBulletins: bulletinsPendingRes.count ?? 0,
        escrowDisputes: escrowPendingRes.count ?? 0,
      });
    } catch {
      // keep existing UI cleanly
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAuditFeeds();
    });
  }, [loadAuditFeeds]);

  const handleToggleHideSampleData = async () => {
    if (isTogglingSample) return;
    const nextEnabled = !hideSampleData;
    const ok = await confirmSystem({
      title: nextEnabled
        ? 'Enable Production Mode (Hide [SAMPLE] Data)?'
        : 'Restore Preview / Seed Mode?',
      description: nextEnabled
        ? 'Hides all [SAMPLE] seed listings, marketplace items, and bulletins across public discovery pages immediately.'
        : 'Makes [SAMPLE] seed records publicly visible across Explore, Marketplace, and Bulletin again.',
      caution:
        'This global platform_settings switch affects every public visitor immediately.',
      confirmLabel: nextEnabled ? 'Enable Production Mode' : 'Restore Sample Data',
      variant: 'warning',
    });
    if (!ok) return;

    setIsTogglingSample(true);
    setHideSampleData(nextEnabled);
    setAppStatus(
      'saving',
      nextEnabled ? 'Enabling Production Mode…' : 'Restoring [SAMPLE] records…'
    );

    try {
      const [platformRes] = await Promise.all([
        updateHideSampleDataFlag(nextEnabled, authUser?.id || null),
        updateAppSetting('show_sample_data', !nextEnabled),
      ]);

      if (!platformRes.ok) {
        setHideSampleData(!nextEnabled);
        throw new Error(
          platformRes.error || 'Failed to persist hide_sample_data setting.'
        );
      }

      const msg = nextEnabled
        ? 'Production Mode enabled: all [SAMPLE] listings, marketplace products, and bulletins are now hidden publicly.'
        : 'Preview Mode restored: [SAMPLE] seed records are visible across Explore, Marketplace, and Bulletin.';
      setPurgeBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus(
        'success',
        nextEnabled ? 'Production Mode active' : 'Sample data visible'
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to update Production Mode setting.';
      setPurgeBanner({ type: 'error', text: msg });
      onNotice?.({ type: 'error', text: msg });
      setAppStatus('error', 'Launch switch failed');
    } finally {
      setIsTogglingSample(false);
    }
  };

  const handleRunPodPurge = async () => {
    const ok = await confirmSystem({
      title: 'Run 48-Hour Private POD Purge Now?',
      description:
        'Permanently deletes expired Proof-of-Delivery images older than 48 hours from private Supabase Storage.',
      caution: 'Deleted POD objects cannot be recovered once purged.',
      impactSummary: [
        'Target bucket: private pod storage',
        'Retention cutoff: > 48 hours post-delivery',
        'Active disputes inside the 48h window are preserved',
      ],
      confirmLabel: 'Run POD Purge',
      variant: 'warning',
    });
    if (!ok) return;

    setIsPurging(true);
    setAppStatus('saving', 'Running 48h POD purge…');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch('/api/pick-n-drop/purge-pods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        purged_count?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || `Purge request failed (${res.status}).`);
      }

      const count = Number(data.purged_count || 0);
      const msg =
        count > 0
          ? `Purged ${count} expired POD image${count === 1 ? '' : 's'} older than 48h.`
          : '48h POD purge check complete — no expired POD images due for deletion.';
      setPurgeBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'POD purge completed');
      await loadAuditFeeds();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to trigger POD purge.';
      setPurgeBanner({ type: 'error', text: msg });
      onNotice?.({ type: 'error', text: msg });
      setAppStatus('error', 'POD purge failed');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Phase v15f: Production Readiness & System Health Indicators */}
      <section
        data-testid="superadmin-system-readiness-card"
        className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
              <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>System Readiness &amp; Launch Health</span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Environment safety checks, live moderation queue backlog, and 48-hour POD pg_cron verification checklist.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAuditFeeds()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Health</span>
          </button>
        </div>

        {/* 1. NEXT_PUBLIC_ENABLE_DEMO_AUTH Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              {demoAuthEnabled ? (
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
              )}
              <code className="font-mono text-[11px]">
                NEXT_PUBLIC_ENABLE_DEMO_AUTH
              </code>
            </p>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              {demoAuthEnabled
                ? 'Demo quick-login buttons are currently enabled in this build. Set to false in production env before public launch.'
                : 'Demo authentication shortcuts are disabled. Standard Supabase Auth & OTP sessions enforced.'}
            </p>
          </div>
          <span
            data-testid="system-health-demo-auth-badge"
            className={`inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold ${
              demoAuthEnabled
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {demoAuthEnabled ? (
              <>
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>WARNING · ENABLED</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>DISABLED · SAFE</span>
              </>
            )}
          </span>
        </div>

        {/* 2. Live Pending Moderation Queue Counts */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Live Pending Moderation Queues
          </p>
          {isLoading || !queueCounts ? (
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
                >
                  <div className="dd-shimmer h-3 w-24 rounded-md" />
                  <div className="dd-shimmer h-6 w-12 rounded-md" />
                </div>
              ))}
            </div>
          ) : (
            <div
              data-testid="system-health-queue-counts"
              className="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
            >
              {[
                {
                  label: 'Pending Listings',
                  value: queueCounts.pendingListings,
                  warn: queueCounts.pendingListings > 0,
                },
                {
                  label: 'Partner Apps & KYC',
                  value: queueCounts.pendingPartnerApps,
                  warn: queueCounts.pendingPartnerApps > 0,
                },
                {
                  label: 'Bulletins / Reports',
                  value: queueCounts.pendingBulletins,
                  warn: queueCounts.pendingBulletins > 0,
                },
                {
                  label: 'Escrow / Disputes',
                  value: queueCounts.escrowDisputes,
                  warn: queueCounts.escrowDisputes > 0,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
                >
                  <p className="text-[11px] font-medium text-[var(--ps-text-muted)]">
                    {stat.label}
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-lg font-bold tabular-nums text-[var(--ps-text)]">
                      {stat.value}
                    </span>
                    <span
                      className={`text-[10px] font-semibold ${
                        stat.warn
                          ? 'text-amber-600 dark:text-amber-300'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {stat.warn ? 'Action needed' : 'Clear'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. 48-Hour POD pg_cron Verification Checklist */}
        <div
          data-testid="system-health-pod-checklist"
          className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
              <Clock className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>48-Hour POD pg_cron Verification Checklist</span>
            </p>
            <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
              {[
                podChecklist.bucketPrivateRls,
                podChecklist.pgCronScheduled,
                podChecklist.retention48hVerified,
              ].filter(Boolean).length}
              /3 verified
            </span>
          </div>
          <div className="space-y-1.5">
            {(
              [
                {
                  key: 'bucketPrivateRls' as const,
                  title: 'Private POD bucket RLS active (signed URLs only)',
                  detail:
                    'Confirm `pod` bucket is private and direct public object URLs return 400/403.',
                },
                {
                  key: 'pgCronScheduled' as const,
                  title: 'Supabase pg_cron job scheduled (`purge_expired_pod_objects`)',
                  detail:
                    'Verify `SELECT * FROM cron.job;` in SQL Editor lists the hourly 48h POD cleanup job.',
                },
                {
                  key: 'retention48hVerified' as const,
                  title: '48-hour cooling-off purge tested via Run Purge button',
                  detail:
                    'Trigger manual dry-run below and confirm `delivery_order_events` logs completion.',
                },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs hover:bg-[var(--ps-surface-alt)]/50"
              >
                <input
                  type="checkbox"
                  checked={podChecklist[item.key]}
                  onChange={(e) =>
                    setPodChecklist((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-[var(--ps-border)] accent-[var(--ps-accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--ps-text)]">
                    {item.title}
                  </span>
                  <span className="block text-[11px] text-[var(--ps-text-muted)]">
                    {item.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Production Mode: Hide [SAMPLE] Data Launch Switch */}
      <section
        data-testid="superadmin-production-mode-card"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
      >
        <div className="space-y-1 max-w-2xl">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
            {hideSampleData ? (
              <Rocket className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <EyeOff className="h-4 w-4 text-amber-500 shrink-0" />
            )}
            <span>Production Mode: Hide [SAMPLE] Data</span>
          </h2>
          <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
            Global launch-day switch backed by <code className="font-mono">platform_settings</code>. When enabled, all <code className="font-mono">[SAMPLE]</code> seed listings, marketplace products, and bulletins are filtered out across Explore, Marketplace, Bulletin, and Homepage snapshots.
          </p>
          <p
            className={`text-[11px] font-semibold ${
              hideSampleData
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {hideSampleData
              ? 'Status: Production Mode Active — [SAMPLE] records hidden globally'
              : 'Status: Preview / Seed Mode — [SAMPLE] records currently visible'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={hideSampleData}
          disabled={isTogglingSample}
          onClick={() => void handleToggleHideSampleData()}
          data-testid="superadmin-hide-sample-toggle"
          className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-xs font-bold transition-colors disabled:opacity-60 shrink-0 ${
            hideSampleData
              ? 'border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
          }`}
        >
          {isTogglingSample ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                hideSampleData ? 'bg-white' : 'bg-amber-500'
              }`}
            />
          )}
          <span>{hideSampleData ? 'Hide [SAMPLE]: ON' : 'Hide [SAMPLE]: OFF'}</span>
        </button>
      </section>

      {/* 48h POD Purge Control */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
            <Trash2 className="h-4 w-4 text-rose-500" />
            <span>48-Hour Private POD Privacy Purge</span>
          </h2>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Immediately delete expired Proof-of-Delivery images from private
            storage whose 48h cooling-off window has elapsed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAuditFeeds()}
            aria-label="Refresh audit logs"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            disabled={isPurging}
            onClick={() => void handleRunPodPurge()}
            data-testid="superadmin-run-pod-purge-btn"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-60 cursor-pointer"
          >
            {isPurging ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>Run 48h POD Purge Now</span>
          </button>
        </div>
      </section>

      {purgeBanner && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
            purgeBanner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {purgeBanner.type === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{purgeBanner.text}</span>
        </div>
      )}

      {/* Dual Audit Streams */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--ps-text)]">
            <Truck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Delivery Order Events ({deliveryEvents.length})</span>
          </h3>
          {isLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5"
                >
                  <div className="dd-shimmer h-3.5 w-32 rounded-md" />
                  <div className="dd-shimmer h-3 w-48 rounded-md" />
                </div>
              ))}
            </div>
          ) : deliveryEvents.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
              No delivery audit events recorded yet.
            </p>
          ) : (
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {deliveryEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[var(--ps-accent)]">
                      {ev.event_type}
                    </span>
                    <span className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                      {new Date(ev.created_at).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--ps-text-muted)]">
                    Order: {ev.order_id}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--ps-text)]">
            <Activity className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Bulletin Audit Logs ({bulletinLogs.length})</span>
          </h3>
          {isLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5"
                >
                  <div className="dd-shimmer h-3.5 w-28 rounded-md" />
                  <div className="dd-shimmer h-3 w-44 rounded-md" />
                </div>
              ))}
            </div>
          ) : bulletinLogs.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
              No bulletin audit logs recorded yet.
            </p>
          ) : (
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {bulletinLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[var(--ps-text)]">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </span>
                  </div>
                  {log.bulletin_id && (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--ps-text-muted)]">
                      Bulletin: {log.bulletin_id}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {systemConfirmDialog}
    </div>
  );
}

// =============================================================================
// UNIFIED SUPER-ADMIN PANEL WRAPPER
// =============================================================================
export function SuperAdminPanel({ onNotice }: SuperAdminSectionNoticeProps) {
  const [subTab, setSubTab] = useState<
    'master_control' | 'payments' | 'users' | 'rates' | 'audit'
  >('master_control');
  return (
    <div className="space-y-4 min-w-0 max-w-full overflow-x-clip">
      <div className="flex w-full max-w-full flex-nowrap gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {[
          {
            id: 'master_control' as const,
            label: 'Master Control',
            icon: Crown,
          },
          {
            id: 'payments' as const,
            label: 'Payments Queue',
            icon: CreditCard,
          },
          { id: 'users' as const, label: 'Users & Roles', icon: Users },
          { id: 'rates' as const, label: 'Rates & Plans', icon: Sliders },
          { id: 'audit' as const, label: 'System & Audit', icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {subTab === 'master_control' && (
        <MasterControlConsole onNotice={onNotice} />
      )}
      {subTab === 'payments' && (
        <MediatorDeskRedirectCard title="Manual payments moved to the Mediator Desk" />
      )}
      {subTab === 'users' && <SuperAdminUsersRolesSection onNotice={onNotice} />}
      {subTab === 'rates' && <SuperAdminRatesPlansSection onNotice={onNotice} />}
      {subTab === 'audit' && (
        <SuperAdminSystemAuditSection onNotice={onNotice} />
      )}
    </div>
  );
}

export default SuperAdminPanel;
