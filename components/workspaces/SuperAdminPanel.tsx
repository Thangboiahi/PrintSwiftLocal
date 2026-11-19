'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Crown,
  EyeOff,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Shield,
  Sliders,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
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
    value: 'admin',
    label: 'Admin',
    description: 'Moderation, Bulletins, Fleet & Escrow',
  },
  {
    value: 'super_admin',
    label: 'Super Admin',
    description: 'Full governance, roles, rate cards & audit',
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
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.full_name || u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleAssignRole = async (userRow: ProfileUserRow, nextRole: string) => {
    if (nextRole === userRow.role) return;
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Super-Admin Role Governance ({users.length})
            </h2>
          </div>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Search accounts and assign roles (Visitor, Driver, Staff, Owner,
            Admin, Super Admin) via secure RPC.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, role…"
              className="h-8 w-52 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-2.5 text-xs text-[var(--ps-text)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            aria-label="Refresh users"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
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

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading profiles…
        </div>
      ) : filteredUsers.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
          No matching user profiles found.
        </p>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {filteredUsers.map((u) => (
            <div
              key={u.id}
              className="flex flex-col gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-[var(--ps-text)]">
                  {u.full_name || u.name || 'Unnamed User'}
                </p>
                <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                  {u.email || u.id}
                  {u.phone ? ` • ${u.phone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:w-52 shrink-0">
                {savingUserId === u.id ? (
                  <div className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px] text-[var(--ps-text-muted)]">
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
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
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
          .from('subscription_plans')
          .select('*')
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
      <div className="flex items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-10 text-xs text-[var(--ps-text-muted)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading vehicle rate cards &amp; subscription plans…
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

  const loadAuditFeeds = useCallback(async () => {
    setIsLoading(true);
    try {
      const sampleFlag = await fetchHideSampleDataFlag(true);
      setHideSampleData(sampleFlag);

      if (!isSupabaseConfigured()) {
        return;
      }

      const [bulRes, delRes] = await Promise.all([
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
      ]);
      setBulletinLogs((bulRes.data || []) as BulletinAuditLogRow[]);
      setDeliveryEvents((delRes.data || []) as DeliveryEventRow[]);
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={isPurging}
            onClick={() => void handleRunPodPurge()}
            data-testid="superadmin-run-pod-purge-btn"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-60"
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
            <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
              Loading events…
            </p>
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
            <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
              Loading logs…
            </p>
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
    </div>
  );
}

// =============================================================================
// UNIFIED SUPER-ADMIN PANEL WRAPPER
// =============================================================================
export function SuperAdminPanel({ onNotice }: SuperAdminSectionNoticeProps) {
  const [subTab, setSubTab] = useState<'users' | 'rates' | 'audit'>('users');
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[
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

      {subTab === 'users' && <SuperAdminUsersRolesSection onNotice={onNotice} />}
      {subTab === 'rates' && <SuperAdminRatesPlansSection onNotice={onNotice} />}
      {subTab === 'audit' && (
        <SuperAdminSystemAuditSection onNotice={onNotice} />
      )}
    </div>
  );
}

export default SuperAdminPanel;
