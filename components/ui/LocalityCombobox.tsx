'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Globe,
  Loader2,
  MapPin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';

export interface LocalitySelection {
  id: string | null;
  slug?: string | null;
  display_name: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
  origin?:
    | 'local_verified'
    | 'local_pending'
    | 'google_reference'
    | 'user_submitted';
}

interface SuggestApiItem {
  id: string | null;
  hub_id: string;
  slug: string | null;
  display_name: string;
  secondary_text?: string | null;
  aliases: string[];
  lat: number | null;
  lng: number | null;
  source: string;
  status: 'verified' | 'pending' | 'external';
  usage_count: number;
  origin: 'local_verified' | 'local_pending' | 'google_reference';
  place_id?: string | null;
}

export interface LocalityComboboxProps {
  hubId?: string | null;
  value?: { id?: string | null; display_name: string } | null;
  onSelect: (loc: LocalitySelection) => void;
  onClear?: () => void;
  allowCreate?: boolean;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
}

function generateSessionToken(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function LocalityCombobox({
  hubId,
  value,
  onSelect,
  onClear,
  allowCreate = true,
  placeholder = 'Search locality, veng, or area...',
  label,
  disabled = false,
  className = '',
  id,
  defaultLat = null,
  defaultLng = null,
}: LocalityComboboxProps) {
  const { activeHub, hubLocalities } = useAppConfig();
  const { session } = useAuth();
  const { setStatus } = useAppStatus();
  const accessToken = session?.access_token ?? null;
  const generatedId = useId();
  const listboxId = `${id || generatedId}-listbox`;

  const effectiveHubId = (hubId || activeHub?.id || '').trim();
  const effectiveHubName = activeHub?.name || 'Local Hub';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sessionTokenRef = useRef<string>(generateSessionToken());
  const abortControllerRef = useRef<AbortController | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value?.display_name || '');
  const [isEditing, setIsEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestApiItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Instant zero-latency local fallback from AppConfig verified hubLocalities
  const cachedHubItems = useMemo<SuggestApiItem[]>(() => {
    const filtered = hubLocalities.filter((loc) =>
      effectiveHubId ? loc.hub_id === effectiveHubId : true
    );
    const trimmed = query.trim().toLowerCase();
    const matched = trimmed
      ? filtered.filter(
          (loc) =>
            loc.display_name.toLowerCase().includes(trimmed) ||
            loc.aliases.some((a) => a.toLowerCase().includes(trimmed))
        )
      : filtered;

    return matched.slice(0, 8).map((loc) => ({
      id: loc.id,
      hub_id: loc.hub_id,
      slug: loc.slug,
      display_name: loc.display_name,
      secondary_text: effectiveHubName,
      aliases: loc.aliases,
      lat: loc.lat,
      lng: loc.lng,
      source: loc.status === 'verified' ? 'admin_seed' : 'user_submitted',
      status: loc.status === 'verified' ? 'verified' : 'pending',
      usage_count: loc.usage_count,
      origin:
        loc.status === 'verified' ? 'local_verified' : 'local_pending',
      place_id: null,
    }));
  }, [hubLocalities, effectiveHubId, effectiveHubName, query]);

  const inputDisplayValue = isEditing ? query : value?.display_name || '';

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setIsEditing(false);
        setQuery(value?.display_name || '');
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, value?.display_name]);

  // Debounced 250ms server suggest fetch with AbortController
  useEffect(() => {
    if (!isOpen || disabled) return;

    const timer = window.setTimeout(async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setErrorMsg(null);
      try {
        const params = new URLSearchParams();
        if (effectiveHubId) params.set('hubId', effectiveHubId);
        if (query.trim()) params.set('q', query.trim());
        params.set('sessionToken', sessionTokenRef.current);

        const headers: HeadersInit = {};
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const res = await fetch(`/api/localities/suggest?${params.toString()}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!res.ok) {
          throw new Error('Could not load suggestions');
        }

        const data = (await res.json()) as {
          suggestions?: SuggestApiItem[];
        };
        if (Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // Keep cachedHubItems visible on rural/offline network failures
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, disabled, query, effectiveHubId, accessToken]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const displayedSuggestions = useMemo(() => {
    if (suggestions.length > 0 || !isLoading) {
      return suggestions.length > 0 ? suggestions : cachedHubItems;
    }
    return cachedHubItems;
  }, [suggestions, cachedHubItems, isLoading]);

  const trimmedQuery = query.trim();
  const hasExactMatch = useMemo(() => {
    if (!trimmedQuery) return true;
    const lower = trimmedQuery.toLowerCase();
    return displayedSuggestions.some(
      (item) =>
        item.display_name.toLowerCase() === lower ||
        item.aliases.some((a) => a.toLowerCase() === lower)
    );
  }, [trimmedQuery, displayedSuggestions]);

  const showCreateOption =
    allowCreate && trimmedQuery.length >= 2 && !hasExactMatch;

  const totalNavigableCount =
    displayedSuggestions.length + (showCreateOption ? 1 : 0);

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = generateSessionToken();
  }, []);

  const resolveAndEmit = useCallback(
    async (
      name: string,
      source: 'user_submitted' | 'google_places',
      lat: number | null,
      lng: number | null
    ) => {
      const cleanName = name.trim();
      if (cleanName.length < 2) return;

      // If user is authenticated, persist/resolve via atomic RPC endpoint
      if (accessToken) {
        setIsResolving(true);
        setErrorMsg(null);
        setStatus('saving', 'Saving locality');
        try {
          const res = await fetch('/api/localities/resolve', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              hubId: effectiveHubId || null,
              name: cleanName,
              lat: lat ?? defaultLat ?? null,
              lng: lng ?? defaultLng ?? null,
              source,
            }),
          });

          const payload = (await res.json().catch(() => ({}))) as {
            locality?: {
              id: string;
              slug?: string;
              display_name: string;
              lat?: number | null;
              lng?: number | null;
              status?: string;
            };
            error?: string;
          };

          if (res.ok && payload.locality) {
            setStatus('success', 'Locality selected');
            onSelect({
              id: payload.locality.id,
              slug: payload.locality.slug || null,
              display_name: payload.locality.display_name,
              lat: payload.locality.lat ?? lat ?? defaultLat ?? null,
              lng: payload.locality.lng ?? lng ?? defaultLng ?? null,
              status: payload.locality.status || 'pending',
              origin:
                payload.locality.status === 'verified'
                  ? 'local_verified'
                  : 'local_pending',
            });
            setQuery(payload.locality.display_name);
            setIsEditing(false);
            setIsOpen(false);
            resetSessionToken();
            return;
          }

          setErrorMsg(payload.error || 'Using locality locally');
          setStatus('error', 'Could not sync locality');
        } catch {
          setStatus('error', 'Network error');
        } finally {
          setIsResolving(false);
        }
      }

      // Graceful local fallback for guests or offline submission
      onSelect({
        id: null,
        slug: null,
        display_name: cleanName,
        lat: lat ?? defaultLat ?? null,
        lng: lng ?? defaultLng ?? null,
        status: 'pending',
        origin: source === 'google_places' ? 'google_reference' : 'user_submitted',
      });
      setQuery(cleanName);
      setIsEditing(false);
      setIsOpen(false);
      resetSessionToken();
    },
    [
      accessToken,
      effectiveHubId,
      defaultLat,
      defaultLng,
      onSelect,
      resetSessionToken,
      setStatus,
    ]
  );

  const handleSelectSuggestion = useCallback(
    async (item: SuggestApiItem) => {
      if (item.origin === 'google_reference' && allowCreate) {
        await resolveAndEmit(
          item.display_name,
          'google_places',
          item.lat,
          item.lng
        );
        return;
      }

      onSelect({
        id: item.id,
        slug: item.slug,
        display_name: item.display_name,
        lat: item.lat,
        lng: item.lng,
        status: item.status,
        origin: item.origin,
      });
      setQuery(item.display_name);
      setIsEditing(false);
      setIsOpen(false);
      setActiveIndex(-1);
      resetSessionToken();
    },
    [allowCreate, onSelect, resetSessionToken, resolveAndEmit]
  );

  const handleCreateCustom = useCallback(async () => {
    if (!showCreateOption) return;
    await resolveAndEmit(trimmedQuery, 'user_submitted', defaultLat, defaultLng);
  }, [showCreateOption, trimmedQuery, defaultLat, defaultLng, resolveAndEmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        setIsEditing(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setIsEditing(false);
      setQuery(value?.display_name || '');
      setActiveIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalNavigableCount === 0) return;
      setActiveIndex((prev) => (prev + 1) % totalNavigableCount);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalNavigableCount === 0) return;
      setActiveIndex((prev) =>
        prev <= 0 ? totalNavigableCount - 1 : prev - 1
      );
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < displayedSuggestions.length) {
        void handleSelectSuggestion(displayedSuggestions[activeIndex]);
      } else if (
        showCreateOption &&
        activeIndex === displayedSuggestions.length
      ) {
        void handleCreateCustom();
      } else if (displayedSuggestions.length > 0) {
        void handleSelectSuggestion(displayedSuggestions[0]);
      } else if (showCreateOption) {
        void handleCreateCustom();
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
      {label && (
        <label
          htmlFor={id}
          className="block text-[11px] font-semibold text-[var(--ps-text)] mb-1"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        <MapPin className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-2.5 pointer-events-none" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={label || placeholder}
          disabled={disabled || isResolving}
          value={inputDisplayValue}
          placeholder={placeholder}
          onFocus={() => {
            if (disabled) return;
            resetSessionToken();
            setQuery(value?.display_name || '');
            setIsEditing(true);
            setIsOpen(true);
          }}
          onChange={(e) => {
            setIsEditing(true);
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          className="w-full h-9 pl-8 pr-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-medium text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {(isLoading || isResolving) && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ps-text-muted)]" />
          )}
          {!isLoading &&
            !isResolving &&
            (inputDisplayValue || value?.display_name) &&
            !disabled && (
              <button
                type="button"
                aria-label="Clear locality"
                onClick={() => {
                  setQuery('');
                  setIsEditing(true);
                  setActiveIndex(-1);
                  if (onClear) {
                    onClear();
                  } else {
                    onSelect({
                      id: null,
                      slug: null,
                      display_name: '',
                      lat: null,
                      lng: null,
                    });
                  }
                  inputRef.current?.focus();
                }}
                className="w-5 h-5 inline-flex items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
        </div>
      </div>

      {errorMsg && (
        <p className="mt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          {errorMsg}
        </p>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.14 }}
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 mt-1.5 z-50 max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl py-1"
          >
            {displayedSuggestions.length === 0 && !showCreateOption && (
              <div className="px-3 py-3 text-center">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                  <span>
                    {isLoading
                      ? 'Searching localities...'
                      : `No localities found in ${effectiveHubName}`}
                  </span>
                </div>
              </div>
            )}

            {displayedSuggestions.map((item, idx) => {
              const isSelected =
                (value?.id && item.id && value.id === item.id) ||
                (!value?.id &&
                  value?.display_name &&
                  value.display_name.toLowerCase() ===
                    item.display_name.toLowerCase());
              const isHighlighted = idx === activeIndex;

              return (
                <button
                  key={`${item.origin}-${item.id || item.place_id || item.display_name}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={Boolean(isSelected)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => void handleSelectSuggestion(item)}
                  className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                    isHighlighted
                      ? 'bg-slate-100 dark:bg-slate-800/80'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    {item.origin === 'local_verified' ? (
                      <span
                        title="Verified locality"
                        className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                      />
                    ) : item.origin === 'local_pending' ? (
                      <span
                        title="Pending verification"
                        className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
                      />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {item.display_name}
                      </div>
                      {(item.secondary_text || item.aliases.length > 0) && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {item.aliases.length > 0
                            ? `Also: ${item.aliases.slice(0, 2).join(', ')}`
                            : item.secondary_text}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.origin === 'local_verified' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60">
                        Verified
                      </span>
                    )}
                    {item.origin === 'local_pending' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/50">
                        Pending
                      </span>
                    )}
                    {item.origin === 'google_reference' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Google Ref
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}

            {showCreateOption && (
              <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === displayedSuggestions.length}
                  onMouseEnter={() =>
                    setActiveIndex(displayedSuggestions.length)
                  }
                  onClick={() => void handleCreateCustom()}
                  disabled={isResolving}
                  className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-semibold transition-colors cursor-pointer ${
                    activeIndex === displayedSuggestions.length
                      ? 'bg-slate-100 dark:bg-slate-800 text-theme-primary'
                      : 'text-theme-primary hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    Use &ldquo;{trimmedQuery}&rdquo; as new locality
                  </span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LocalityCombobox;
