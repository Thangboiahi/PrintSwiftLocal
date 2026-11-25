'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Lock,
  RefreshCw,
  Shield,
  Truck,
  Users,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

interface UserRoleRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface DriverKycRow {
  id: string;
  profile_id: string;
  full_name: string;
  kyc_verified: boolean;
  kyc_status: string;
  is_online: boolean;
}

// `super_admin` is strictly immutable via UI/API (DB trigger enforced)
const ROLE_OPTIONS: CustomSelectOption[] = [
  { value: 'visitor', label: 'Visitor' },
  { value: 'owner', label: 'Business Owner' },
  { value: 'staff', label: 'Staff' },
  { value: 'driver', label: 'Driver' },
  { value: 'hub_manager', label: 'Hub Manager' },
  { value: 'admin', label: 'Admin (Civic Staff)' },
];

export function UsersDriversManagersTab() {
  const [users, setUsers] = useState<UserRoleRow[]>([]);
  const [drivers, setDrivers] = useState<DriverKycRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [usersRes, driversRes] = await Promise.allSettled([
        supabase
          .from('profiles')
          .select('id, full_name, name, email, role')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('drivers')
          .select('id, profile_id, full_name, kyc_verified, kyc_status, is_online')
          .order('created_at', { ascending: false })
          .limit(80),
      ]);

      if (
        usersRes.status === 'fulfilled' &&
        !usersRes.value.error &&
        Array.isArray(usersRes.value.data)
      ) {
        setUsers(
          (usersRes.value.data as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id || ''),
            full_name: String(r.full_name || r.name || 'User'),
            email: String(r.email || ''),
            role: String(r.role || 'visitor'),
          }))
        );
      }

      if (
        driversRes.status === 'fulfilled' &&
        !driversRes.value.error &&
        Array.isArray(driversRes.value.data)
      ) {
        setDrivers(
          (driversRes.value.data as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id || ''),
            profile_id: String(r.profile_id || ''),
            full_name: String(r.full_name || 'Driver'),
            kyc_verified: Boolean(r.kyc_verified || r.kyc_status === 'verified'),
            kyc_status: String(r.kyc_status || (r.kyc_verified ? 'verified' : 'pending')),
            is_online: Boolean(r.is_online),
          }))
        );
      }
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleSetRole = async (userRow: UserRoleRow, newRole: string) => {
    if (
      userRow.role === 'super_admin' ||
      newRole === 'super_admin' ||
      newRole === userRow.role
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
    const isRevoke = (roleRank[newRole] ?? 0) < (roleRank[userRow.role] ?? 0);

    const ok = await confirm({
      title: isRevoke
        ? `Revoke / Demote Role for ${userRow.full_name}?`
        : `Grant "${newRole.replace(/_/g, ' ')}" Role to ${userRow.full_name}?`,
      description: `Change platform role from "${userRow.role}" to "${newRole}" via superadmin_set_user_role RPC.`,
      caution: isRevoke
        ? 'Workspace permissions for the previous role will be revoked immediately.'
        : 'Account will gain access to the assigned role workspace immediately.',
      impactSummary: [
        `Account: ${userRow.full_name} (${userRow.email || userRow.id.slice(0, 8)})`,
        `Role change: ${userRow.role} → ${newRole}`,
      ],
      confirmLabel: isRevoke ? 'Confirm Demotion' : 'Confirm Role Grant',
      variant: isRevoke ? 'danger' : 'warning',
    });
    if (!ok) return;

    setAppStatus('saving', `Updating role to ${newRole}…`);
    const { error } = await supabase.rpc('superadmin_set_user_role', {
      p_target_user_id: userRow.id,
      p_new_role: newRole,
    });
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === userRow.id ? { ...u, role: newRole } : u))
    );
    setAppStatus('success', `Role updated to ${newRole}.`);
  };

  const handleToggleDriverKyc = async (driver: DriverKycRow) => {
    const nextVal = !driver.kyc_verified;
    const nextStatus = nextVal ? 'verified' : 'suspended';

    const ok = await confirm({
      title: nextVal
        ? `Approve Driver KYC for ${driver.full_name}?`
        : `Suspend Driver KYC for ${driver.full_name}?`,
      description: nextVal
        ? 'Marks this driver KYC-verified so they can accept live Pick N Drop dispatches.'
        : 'Suspends this driver immediately and prevents them from accepting new Pick N Drop orders.',
      caution: nextVal
        ? 'Verify driving license and vehicle documents before approving.'
        : 'Driver will remain unable to go online until KYC is re-approved.',
      confirmLabel: nextVal ? 'Approve KYC' : 'Suspend KYC',
      variant: nextVal ? 'warning' : 'danger',
    });
    if (!ok) return;

    setAppStatus('saving', nextVal ? 'Approving driver KYC…' : 'Suspending driver KYC…');
    const { error } = await supabase
      .from('drivers')
      .update({ kyc_verified: nextVal, kyc_status: nextStatus })
      .eq('id', driver.id);
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setDrivers((prev) =>
      prev.map((d) =>
        d.id === driver.id
          ? { ...d, kyc_verified: nextVal, kyc_status: nextStatus }
          : d
      )
    );
    setAppStatus('success', nextVal ? 'Driver KYC approved.' : 'Driver KYC suspended.');
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return `${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  return (
    <div
      data-testid="users-drivers-managers-tab"
      className="space-y-5 min-w-0 max-w-full overflow-x-clip text-xs"
    >
      {/* Users & Roles Table */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[var(--ps-accent)]" />
              <span>Users, Civic Admins &amp; Hub Managers</span>
            </h3>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Promote or revoke platform roles (`hub_manager`, `admin`, `driver`, `owner`) via audited RPC.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="min-h-[44px] px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <WorkspaceTableToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search user name, email, or role…"
          hasActiveFilters={Boolean(search || roleFilter !== 'all')}
          onResetFilters={() => {
            setSearch('');
            setRoleFilter('all');
          }}
        >
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {['all', 'hub_manager', 'admin', 'driver', 'owner'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold capitalize whitespace-nowrap cursor-pointer ${
                  roleFilter === r
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                }`}
              >
                {r.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        {isLoading ? (
          <div className="space-y-2.5" aria-busy="true">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="dd-shimmer h-3.5 w-36 rounded-md" />
                  <div className="dd-shimmer h-3 w-48 rounded-md" />
                </div>
                <div className="dd-shimmer h-10 w-36 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Mobile stacked cards */}
            <div className="space-y-2.5 md:hidden">
              {filteredUsers.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5"
                >
                  <div>
                    <p className="font-bold text-[var(--ps-text)]">{u.full_name}</p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                      {u.email || 'No email'}
                    </p>
                  </div>
                  {u.role === 'super_admin' ? (
                    <span
                      title="Managed via SQL migration only"
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-700 dark:text-rose-300 select-none"
                    >
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      <span>Super Admin · Locked</span>
                    </span>
                  ) : (
                    <CustomSelectModal
                      options={ROLE_OPTIONS}
                      value={u.role}
                      onChange={(val) => void handleSetRole(u, val)}
                      className="[&>button]:min-h-[44px]"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
              <ResponsiveTableScroll>
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 px-3">User</th>
                      <th className="py-2 px-3">Email</th>
                      <th className="py-2 px-3 text-right">Platform Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredUsers.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2.5 px-3 font-semibold text-[var(--ps-text)]">
                          {u.full_name}
                        </td>
                        <td className="py-2.5 px-3 text-[var(--ps-text-muted)]">
                          {u.email}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {u.role === 'super_admin' ? (
                            <span
                              data-testid={`locked-superadmin-badge-${u.id}`}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-[11px] font-bold text-rose-700 dark:text-rose-300 select-none"
                              title="Managed via SQL migration only"
                            >
                              <Lock className="h-3.5 w-3.5 shrink-0" />
                              <span>Super Admin · Locked</span>
                            </span>
                          ) : (
                            <div className="inline-block w-44 text-left">
                              <CustomSelectModal
                                options={ROLE_OPTIONS}
                                value={u.role}
                                onChange={(val) => void handleSetRole(u, val)}
                                className="[&>button]:min-h-[44px]"
                              />
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
      </section>

      {/* Driver KYC Approvals */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
          <Truck className="w-4 h-4 text-amber-500" />
          <span>Driver KYC Verification ({drivers.length})</span>
        </h3>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="dd-shimmer h-3.5 w-40 rounded-md" />
                <div className="dd-shimmer h-10 w-28 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <ResponsiveTableScroll>
            <table className="w-full text-left border-collapse min-w-[540px]">
              <thead>
                <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2 px-3">Driver</th>
                  <th className="py-2 px-3">Shift</th>
                  <th className="py-2 px-3">KYC Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/60">
                {drivers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-[var(--ps-text-muted)]"
                    >
                      No registered drivers found.
                    </td>
                  </tr>
                ) : (
                  drivers.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2.5 px-3 font-semibold text-[var(--ps-text)]">
                        {d.full_name}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--ps-text-muted)]">
                        {d.is_online ? 'Online' : 'Offline'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            d.kyc_verified
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {d.kyc_verified ? (
                            <BadgeCheck className="w-3 h-3" />
                          ) : (
                            <Shield className="w-3 h-3" />
                          )}
                          {d.kyc_verified ? 'Verified' : 'Pending KYC'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleToggleDriverKyc(d)}
                          className={`min-h-[44px] px-3.5 rounded-xl font-bold text-xs cursor-pointer ${
                            d.kyc_verified
                              ? 'border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              : 'bg-emerald-600 text-white'
                          }`}
                        >
                          {d.kyc_verified ? 'Suspend KYC' : 'Approve KYC'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}

export default UsersDriversManagersTab;
