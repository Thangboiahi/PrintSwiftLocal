'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  RefreshCw,
  Shield,
  Truck,
  Users,
} from 'lucide-react';
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
  user_id: string;
  full_name: string;
  kyc_verified: boolean;
  is_online: boolean;
}

const ROLE_OPTIONS: CustomSelectOption[] = [
  { value: 'visitor', label: 'Visitor' },
  { value: 'owner', label: 'Business Owner' },
  { value: 'staff', label: 'Staff' },
  { value: 'driver', label: 'Driver' },
  { value: 'hub_manager', label: 'Hub Manager' },
  { value: 'admin', label: 'Admin (Civic Staff)' },
  { value: 'super_admin', label: 'Super Admin' },
];

export function UsersDriversManagersTab() {
  const [users, setUsers] = useState<UserRoleRow[]>([]);
  const [drivers, setDrivers] = useState<DriverKycRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

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
          .select('id, user_id, kyc_verified, is_available, profiles:user_id(full_name, name)')
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
          (driversRes.value.data as Array<Record<string, unknown>>).map((r) => {
            const prof = Array.isArray(r.profiles)
              ? (r.profiles[0] as Record<string, unknown> | undefined)
              : (r.profiles as Record<string, unknown> | undefined);
            return {
              id: String(r.id || ''),
              user_id: String(r.user_id || ''),
              full_name: String(prof?.full_name || prof?.name || 'Driver'),
              kyc_verified: Boolean(r.kyc_verified),
              is_online: Boolean(r.is_available),
            };
          })
        );
      }
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSetRole = async (userId: string, newRole: string) => {
    setAppStatus('saving', `Updating role to ${newRole}…`);
    const { error } = await supabase.rpc('superadmin_set_user_role', {
      p_target_user_id: userId,
      p_new_role: newRole,
    });
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
    setAppStatus('success', `Role updated to ${newRole}.`);
  };

  const handleToggleDriverKyc = async (driver: DriverKycRow) => {
    const nextVal = !driver.kyc_verified;
    setAppStatus('saving', nextVal ? 'Approving driver KYC…' : 'Suspending driver KYC…');
    const { error } = await supabase
      .from('drivers')
      .update({ kyc_verified: nextVal })
      .eq('id', driver.id);
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setDrivers((prev) =>
      prev.map((d) =>
        d.id === driver.id ? { ...d, kyc_verified: nextVal } : d
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
      className="space-y-5 text-xs"
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
            className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold inline-flex items-center gap-1 cursor-pointer"
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
          <div className="flex items-center gap-1 flex-wrap">
            {['all', 'hub_manager', 'admin', 'driver', 'owner'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold capitalize cursor-pointer ${
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
                  <td className="py-2 px-3 font-semibold text-[var(--ps-text)]">
                    {u.full_name}
                  </td>
                  <td className="py-2 px-3 text-[var(--ps-text-muted)]">
                    {u.email}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="inline-block w-44">
                      <CustomSelectModal
                        options={ROLE_OPTIONS}
                        value={u.role}
                        onChange={(val) => void handleSetRole(u.id, val)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </section>

      {/* Driver KYC Approvals */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
          <Truck className="w-4 h-4 text-amber-500" />
          <span>Driver KYC Verification ({drivers.length})</span>
        </h3>
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
                    <td className="py-2 px-3 font-semibold text-[var(--ps-text)]">
                      {d.full_name}
                    </td>
                    <td className="py-2 px-3 text-[var(--ps-text-muted)]">
                      {d.is_online ? 'Online' : 'Offline'}
                    </td>
                    <td className="py-2 px-3">
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
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggleDriverKyc(d)}
                        className={`h-7 px-2.5 rounded-lg font-bold text-[11px] cursor-pointer ${
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
      </section>
    </div>
  );
}

export default UsersDriversManagersTab;
