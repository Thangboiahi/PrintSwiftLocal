'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, UserCheck, Users, X } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface TargetableProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface TargetUsersPickerProps {
  selectedUserIds: string[];
  applicableRoles: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
}

function normalizeRoleKey(role: string | null | undefined): string {
  const clean = String(role || 'user').trim().toLowerCase();
  if (clean === 'visitor') return 'user';
  return clean;
}

export function TargetUsersPicker({
  selectedUserIds,
  applicableRoles,
  onChange,
  disabled = false,
}: TargetUsersPickerProps) {
  const [profiles, setProfiles] = useState<TargetableProfileRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [ignoreRoleFilter, setIgnoreRoleFilter] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      if (!isSupabaseConfigured()) {
        if (active) {
          setProfiles([]);
          setIsLoading(false);
        }
        return;
      }

      if (active) {
        setIsLoading(true);
        setLoadError(null);
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, role')
          .order('full_name', { ascending: true, nullsFirst: false })
          .limit(300);

        if (!active) return;

        if (error) {
          setLoadError(error.message || 'Unable to load users.');
          setProfiles([]);
        } else {
          setProfiles(
            Array.isArray(data) ? (data as TargetableProfileRow[]) : []
          );
        }
      } catch (err) {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : 'Unable to load users.'
        );
      } finally {
        if (active) setIsLoading(false);
      }
    }

    queueMicrotask(() => {
      if (active) void loadProfiles();
    });

    return () => {
      active = false;
    };
  }, []);

  const normalizedRoleSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of applicableRoles) {
      const lower = r.trim().toLowerCase();
      if (!lower) continue;
      set.add(lower);
      if (lower === 'visitor') set.add('user');
      if (lower === 'user') set.add('visitor');
    }
    return set;
  }, [applicableRoles]);

  const selectedSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds]
  );

  const selectedProfiles = useMemo(() => {
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return selectedUserIds.map((id) => ({
      id,
      profile: byId.get(id) ?? null,
    }));
  }, [profiles, selectedUserIds]);

  const filteredProfiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shouldFilterByRole =
      !ignoreRoleFilter && normalizedRoleSet.size > 0;

    return profiles.filter((p) => {
      if (shouldFilterByRole) {
        const rawRole = String(p.role || 'user').trim().toLowerCase();
        const normRole = normalizeRoleKey(p.role);
        if (!normalizedRoleSet.has(rawRole) && !normalizedRoleSet.has(normRole)) {
          return false;
        }
      }

      if (!q) return true;
      const hay = [
        p.full_name || '',
        p.email || '',
        p.phone || '',
        p.role || '',
        p.id,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, query, ignoreRoleFilter, normalizedRoleSet]);

  const toggleUser = (userId: string) => {
    if (disabled) return;
    if (selectedSet.has(userId)) {
      onChange(selectedUserIds.filter((id) => id !== userId));
    } else {
      onChange([...selectedUserIds, userId]);
    }
  };

  return (
    <div
      data-testid="target-users-picker"
      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
          <UserCheck className="w-4 h-4 text-[var(--ps-accent)]" />
          <span>Selected Target Individuals ({selectedUserIds.length})</span>
        </div>

        {normalizedRoleSet.size > 0 && (
          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--ps-text-muted)] cursor-pointer select-none min-h-[32px]">
            <input
              type="checkbox"
              checked={ignoreRoleFilter}
              onChange={(e) => setIgnoreRoleFilter(e.target.checked)}
              disabled={disabled}
              className="h-3.5 w-3.5 rounded accent-[var(--ps-accent)]"
            />
            <span>Search all roles (ignore role filter)</span>
          </label>
        )}
      </div>

      {/* Selected User Pills */}
      {selectedProfiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedProfiles.map(({ id, profile }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
            >
              <span className="max-w-[180px] truncate">
                {profile?.full_name || profile?.email || profile?.phone || id.slice(0, 8)}
              </span>
              {profile?.role && (
                <span className="rounded bg-[var(--ps-surface)] px-1 py-0.5 text-[9px] font-bold uppercase text-[var(--ps-text-muted)]">
                  {profile.role}
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleUser(id)}
                aria-label={`Remove ${profile?.full_name || id}`}
                className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface)] hover:text-rose-600 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder={
            !ignoreRoleFilter && normalizedRoleSet.size > 0
              ? `Filter users in selected roles by name, email, or phone…`
              : 'Search all users by name, email, phone, or role…'
          }
          className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-9 pr-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/30"
        />
      </div>

      {/* Results List */}
      {isLoading ? (
        <div className="space-y-2 py-1">
          <div className="h-11 w-full rounded-xl dd-shimmer" />
          <div className="h-11 w-full rounded-xl dd-shimmer" />
          <div className="h-11 w-full rounded-xl dd-shimmer" />
        </div>
      ) : loadError ? (
        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {loadError}
        </p>
      ) : filteredProfiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] px-3 py-4 text-center text-[11px] text-[var(--ps-text-muted)]">
          <Users className="w-4 h-4 mx-auto mb-1 opacity-60" />
          No matching users found
          {!ignoreRoleFilter && normalizedRoleSet.size > 0
            ? ' for the selected applicable roles. Toggle "Search all roles" above to broaden.'
            : '.'}
        </div>
      ) : (
        <div className="max-h-52 overflow-y-auto divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]">
          {filteredProfiles.slice(0, 60).map((profile) => {
            const isSelected = selectedSet.has(profile.id);
            return (
              <button
                key={profile.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleUser(profile.id)}
                className={`w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between gap-2.5 transition-colors ${
                  isSelected
                    ? 'bg-[var(--ps-accent)]/10'
                    : 'hover:bg-[var(--ps-surface-alt)]/70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--ps-text)] truncate">
                      {profile.full_name || 'Unnamed User'}
                    </span>
                    <span className="shrink-0 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                      {profile.role || 'user'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                    {[profile.email, profile.phone].filter(Boolean).join(' · ') ||
                      profile.id}
                  </p>
                </div>

                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    isSelected
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
