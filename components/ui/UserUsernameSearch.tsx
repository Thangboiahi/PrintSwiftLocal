'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AtSign, Search, UserCheck, X, Loader2, Sparkles } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface PublicUsernameProfile {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
  home_hub_id?: string | null;
}

export interface UserUsernameSearchProps {
  /** Currently selected user profile (for single-user assignment mode) */
  selectedUser?: PublicUsernameProfile | null;
  /** Callback when a user is selected from the dropdown */
  onSelect: (user: PublicUsernameProfile | null) => void;
  /** Optional controlled query string */
  query?: string;
  /** Optional callback when raw input text changes */
  onQueryChange?: (q: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Label above the input */
  label?: string;
  /** Optional helper hint below the input */
  helperText?: string;
  /** Disable interaction */
  disabled?: boolean;
  /** Exclude specific user IDs from search results */
  excludeUserIds?: string[];
  /** Compact layout variant */
  size?: 'sm' | 'md';
  /** Data-testid for automated tests */
  testId?: string;
  /** ClassName override */
  className?: string;
}

/**
 * Privacy-preserving @username autocomplete component.
 * Queries `public.search_users_by_username(p_query, p_limit)` which NEVER returns
 * private email addresses or phone numbers—only `{ id, username, full_name, avatar_url, home_hub_id }`.
 */
export function UserUsernameSearch({
  selectedUser = null,
  onSelect,
  query: controlledQuery,
  onQueryChange,
  placeholder = 'Search by @username or name...',
  label,
  helperText,
  disabled = false,
  excludeUserIds = [],
  size = 'md',
  testId = 'user-username-search',
  className = '',
}: UserUsernameSearchProps) {
  const [internalQuery, setInternalQuery] = useState(controlledQuery ?? '');
  const queryValue = controlledQuery !== undefined ? controlledQuery : internalQuery;

  const [results, setResults] = useState<PublicUsernameProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateQuery = useCallback(
    (next: string) => {
      if (controlledQuery === undefined) {
        setInternalQuery(next);
      }
      onQueryChange?.(next);
    },
    [controlledQuery, onQueryChange]
  );

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Debounced 200ms search
  useEffect(() => {
    const cleaned = queryValue.trim().replace(/^@+/, '');
    if (!cleaned || cleaned.length < 1 || disabled) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        let rows: PublicUsernameProfile[] = [];

        if (isSupabaseConfigured()) {
          const { data: rpcData, error: rpcErr } = await supabase.rpc(
            'search_users_by_username',
            {
              p_query: cleaned,
              p_limit: 8,
            }
          );

          if (!rpcErr && Array.isArray(rpcData)) {
            rows = rpcData.map((r: Record<string, unknown>) => ({
              id: String(r.id || ''),
              username: String(r.username || '').replace(/^@+/, ''),
              full_name: String(r.full_name || 'DD oodle Member'),
              avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
              home_hub_id: typeof r.home_hub_id === 'string' ? r.home_hub_id : null,
            }));
          } else {
            // Safe column-restricted fallback (NEVER selects email or phone)
            const { data: profileData } = await supabase
              .from('profiles')
              .select('id, username, full_name, avatar_url, default_hub_id')
              .or(`username.ilike.%${cleaned}%,full_name.ilike.%${cleaned}%`)
              .limit(8);

            if (Array.isArray(profileData)) {
              rows = profileData.map((r: Record<string, unknown>) => ({
                id: String(r.id || ''),
                username: String(
                  r.username || `user_${String(r.id || '').replace(/-/g, '').slice(0, 6)}`
                ).replace(/^@+/, ''),
                full_name: String(r.full_name || 'DD oodle Member'),
                avatar_url: typeof r.avatar_url === 'string' ? r.avatar_url : null,
                home_hub_id: typeof r.default_hub_id === 'string' ? r.default_hub_id : null,
              }));
            }
          }
        }

        if (!cancelled) {
          const filtered = rows.filter(
            (u) => u.id && !excludeUserIds.includes(u.id)
          );
          setResults(filtered);
          setActiveIndex(0);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryValue, disabled, excludeUserIds]);

  const handleSelectUser = (user: PublicUsernameProfile) => {
    onSelect(user);
    updateQuery(`@${user.username}`);
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    updateQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex];
      if (target) handleSelectUser(target);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} data-testid={testId}>
      {label && (
        <label className="mb-1.5 block text-xs font-bold text-[var(--text-primary,var(--ps-text))]">
          {label}
        </label>
      )}

      {selectedUser ? (
        <div
          data-testid={`${testId}-selected-chip`}
          className={`flex items-center justify-between gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 ${
            size === 'sm' ? 'h-9 py-1' : 'min-h-[42px] py-1.5'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-black uppercase text-emerald-600 dark:text-emerald-300 overflow-hidden">
              {selectedUser.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedUser.avatar_url}
                  alt={selectedUser.username}
                  className="h-full w-full object-cover"
                />
              ) : (
                (selectedUser.full_name || selectedUser.username || 'U').slice(0, 1)
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-black text-[var(--text-primary,var(--ps-text))]">
                  @{selectedUser.username}
                </span>
                <UserCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              </div>
              <p className="truncate text-[10px] font-medium text-[var(--text-muted,var(--ps-text-muted))]">
                {selectedUser.full_name}
              </p>
            </div>
          </div>

          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selected user"
              data-testid={`${testId}-clear-btn`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted,var(--ps-text-muted))] hover:bg-black/10 hover:text-[var(--text-primary,var(--ps-text))] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <AtSign className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand-primary,var(--ps-accent))]" />
          <input
            type="text"
            value={queryValue}
            disabled={disabled}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              updateQuery(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            data-testid={`${testId}-input`}
            className={`w-full rounded-xl border border-[var(--border-subtle,var(--ps-border))] bg-[var(--bg-surface,var(--ps-surface))] pl-8 pr-9 text-xs font-medium text-[var(--text-primary,var(--ps-text))] placeholder:text-[var(--text-muted,var(--ps-text-muted))] focus:border-[var(--brand-primary,var(--ps-accent))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary,var(--ps-accent))]/20 disabled:opacity-60 ${
              size === 'sm' ? 'h-9' : 'h-10'
            }`}
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted,var(--ps-text-muted))]" />
            ) : queryValue ? (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-muted,var(--ps-text-muted))] hover:text-[var(--text-primary,var(--ps-text))]"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <Search className="h-3.5 w-3.5 text-[var(--text-muted,var(--ps-text-muted))]" />
            )}
          </div>
        </div>
      )}

      {helperText && (
        <p className="mt-1 text-[10px] text-[var(--text-muted,var(--ps-text-muted))]">
          {helperText}
        </p>
      )}

      {/* Autocomplete Results Dropdown */}
      {isOpen && !selectedUser && queryValue.trim().replace(/^@+/, '').length >= 1 && (
        <div
          data-testid={`${testId}-dropdown`}
          className="absolute left-0 right-0 top-full z-[96] mt-1.5 max-h-60 overflow-y-auto rounded-2xl border border-[var(--border-subtle,var(--ps-border))] bg-[var(--bg-elevated,var(--ps-surface))] p-1.5 shadow-2xl"
        >
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--text-muted,var(--ps-text-muted))]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Searching @usernames...</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-center text-[11px] text-[var(--text-muted,var(--ps-text-muted))]">
              No member found matching <span className="font-bold">@{queryValue.replace(/^@+/, '')}</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {results.map((item, idx) => {
                const active = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectUser(item)}
                    data-testid={`${testId}-option-${item.username}`}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'bg-[var(--brand-primary,var(--ps-accent))]/15 text-[var(--text-primary,var(--ps-text))]'
                        : 'hover:bg-[var(--bg-surface,var(--ps-bg-subtle))] text-[var(--text-primary,var(--ps-text))]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary,var(--ps-accent))]/15 text-[11px] font-black uppercase text-[var(--brand-primary,var(--ps-accent))] overflow-hidden">
                        {item.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.avatar_url}
                            alt={item.username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (item.full_name || item.username || 'U').slice(0, 1)
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-extrabold text-[var(--text-primary,var(--ps-text))]">
                            @{item.username}
                          </span>
                        </div>
                        <p className="truncate text-[10px] text-[var(--text-muted,var(--ps-text-muted))]">
                          {item.full_name}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-[var(--border-subtle,var(--ps-border))] px-2 py-0.5 text-[9px] font-bold text-[var(--text-muted,var(--ps-text-muted))]">
                      Select
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-[var(--border-subtle,var(--ps-border))] px-2.5 pt-1.5 text-[9px] text-[var(--text-muted,var(--ps-text-muted))]">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5 text-emerald-500" />
              Privacy-Protected Handle Lookup
            </span>
            <span>Email & phone hidden</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserUsernameSearch;
