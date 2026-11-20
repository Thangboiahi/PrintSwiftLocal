'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Gift,
  Info,
  Megaphone,
  Sparkles,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type {
  AppAnnouncementRecord,
  AppAnnouncementType,
} from '@/lib/config/types';

const DISMISSED_STORAGE_KEY = 'printswift_dismissed_announcements_v1';
const ROTATE_INTERVAL_MS = 6000;

function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  );
}

function isAnnouncementLive(item: AppAnnouncementRecord, nowMs: number): boolean {
  if (!item.is_active || !item.message.trim()) return false;
  if (item.starts_at) {
    const startMs = Date.parse(item.starts_at);
    if (!Number.isNaN(startMs) && startMs > nowMs) return false;
  }
  if (item.expires_at) {
    const endMs = Date.parse(item.expires_at);
    if (!Number.isNaN(endMs) && endMs <= nowMs) return false;
  }
  return true;
}

const TYPE_STYLES: Record<
  AppAnnouncementType,
  {
    wrapper: string;
    badge: string;
    promoBtn: string;
    ctaLink: string;
    icon: typeof Sparkles;
  }
> = {
  festive: {
    wrapper:
      'bg-gradient-to-r from-amber-50 via-amber-100/90 to-orange-50 text-amber-950 border-b border-amber-300/70 dark:from-amber-950/85 dark:via-amber-900/75 dark:to-orange-950/85 dark:text-amber-50 dark:border-amber-700/60',
    badge:
      'bg-amber-500/20 text-amber-900 border border-amber-500/35 dark:bg-amber-400/20 dark:text-amber-200 dark:border-amber-400/35',
    promoBtn:
      'bg-amber-900/10 hover:bg-amber-900/20 text-amber-950 border border-amber-700/30 dark:bg-amber-300/15 dark:hover:bg-amber-300/25 dark:text-amber-100 dark:border-amber-300/35',
    ctaLink:
      'text-amber-900 hover:text-amber-700 dark:text-amber-200 dark:hover:text-white underline underline-offset-2',
    icon: Sparkles,
  },
  offer: {
    wrapper:
      'bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-slate-900 border-b border-[color-mix(in_srgb,var(--color-primary)_26%,transparent)] dark:bg-[color-mix(in_srgb,var(--color-primary)_22%,#020617)] dark:text-slate-50 dark:border-[color-mix(in_srgb,var(--color-primary)_38%,transparent)]',
    badge:
      'bg-theme-primary text-theme-primary-fg border border-transparent',
    promoBtn:
      'bg-white/80 hover:bg-white text-slate-900 border border-[color-mix(in_srgb,var(--color-primary)_35%,transparent)] dark:bg-slate-900/75 dark:hover:bg-slate-900 dark:text-white dark:border-white/20',
    ctaLink:
      'text-theme-primary hover:opacity-85 dark:text-sky-300 dark:hover:text-white underline underline-offset-2',
    icon: Gift,
  },
  alert: {
    wrapper:
      'bg-rose-50 text-rose-950 border-b border-rose-200 dark:bg-rose-950/90 dark:text-rose-50 dark:border-rose-800/70',
    badge:
      'bg-rose-600 text-white border border-rose-700/40',
    promoBtn:
      'bg-rose-900/10 hover:bg-rose-900/20 text-rose-950 border border-rose-400/40 dark:bg-rose-400/15 dark:hover:bg-rose-400/25 dark:text-rose-100 dark:border-rose-400/35',
    ctaLink:
      'text-rose-800 hover:text-rose-950 dark:text-rose-200 dark:hover:text-white underline underline-offset-2',
    icon: AlertTriangle,
  },
  announcement: {
    wrapper:
      'bg-slate-100 text-slate-900 border-b border-slate-200/90 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-800',
    badge:
      'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border border-transparent',
    promoBtn:
      'bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700',
    ctaLink:
      'text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-white underline underline-offset-2',
    icon: Megaphone,
  },
  info: {
    wrapper:
      'bg-slate-100 text-slate-900 border-b border-slate-200/90 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-800',
    badge:
      'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border border-slate-300/70 dark:border-slate-700',
    promoBtn:
      'bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700',
    ctaLink:
      'text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-white underline underline-offset-2',
    icon: Info,
  },
};

export function GlobalAnnouncementBar() {
  const { announcements, identity } = useAppConfig();
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Hydrate dismissed IDs from sessionStorage safely on mount & keep schedule clock fresh
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = window.sessionStorage.getItem(DISMISSED_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setDismissedIds(parsed.filter((v): v is string => typeof v === 'string'));
          }
        }
      } catch {
        // Ignore sessionStorage restrictions
      }
    });
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  // Build ordered list of visible announcements (with optional legacy identity strip fallback only if enabled)
  const visibleAnnouncements = useMemo<AppAnnouncementRecord[]>(() => {
    const dismissedSet = new Set(dismissedIds);
    const live = announcements.filter(
      (item) => !dismissedSet.has(item.id) && isAnnouncementLive(item, nowMs)
    );

    if (live.length > 0) return live;

    // Fallback to legacy identity.announcement_bar ONLY if explicitly enabled by Super-Admin
    const legacy = identity.announcement_bar;
    if (legacy.enabled && legacy.text.trim()) {
      const legacyId = `legacy::${legacy.variant}::${legacy.text.trim()}`;
      if (!dismissedSet.has(legacyId)) {
        const mappedType: AppAnnouncementType =
          legacy.variant === 'urgent'
            ? 'alert'
            : legacy.variant === 'warning'
              ? 'festive'
              : legacy.variant === 'success'
                ? 'offer'
                : 'info';
        return [
          {
            id: legacyId,
            type: mappedType,
            badge_label: null,
            message: legacy.text.trim(),
            promo_code: null,
            cta_label: legacy.link_url.trim() ? 'View' : null,
            cta_url: legacy.link_url.trim() || null,
            starts_at: null,
            expires_at: null,
            priority: 0,
            is_dismissible: true,
            is_active: true,
          },
        ];
      }
    }

    return [];
  }, [announcements, identity.announcement_bar, dismissedIds, nowMs]);

  const visibleCount = visibleAnnouncements.length;

  useEffect(() => {
    if (visibleCount <= 1 || isPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % visibleCount);
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [visibleCount, isPaused]);

  if (visibleCount === 0) {
    return null;
  }

  const current = visibleAnnouncements[activeIndex % visibleCount];
  const style = TYPE_STYLES[current.type] ?? TYPE_STYLES.info;
  const Icon = style.icon;
  const hasCta = Boolean(current.cta_label?.trim() && isSafeUrl(current.cta_url));
  const ctaUrl = (current.cta_url ?? '').trim();
  const isInternalCta = hasCta && ctaUrl.startsWith('/');
  const promoCode = current.promo_code?.trim().toUpperCase() || '';

  const handleCopyPromo = async () => {
    if (!promoCode) return;
    try {
      await navigator.clipboard.writeText(promoCode);
      setCopiedId(current.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === current.id ? null : prev));
      }, 2000);
    } catch {
      // Fallback for restricted clipboard contexts
      setCopiedId(current.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === current.id ? null : prev));
      }, 2000);
    }
  };

  const handleDismiss = () => {
    const next = Array.from(new Set([...dismissedIds, current.id]));
    setDismissedIds(next);
    setActiveIndex(0);
    try {
      window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <div
      role="status"
      data-testid="global-announcement-bar"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`relative z-[55] w-full shrink-0 min-h-[32px] py-1 px-3 text-xs font-medium transition-colors duration-300 ${style.wrapper}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center sm:flex-nowrap"
            >
              <span className="inline-flex items-center gap-1 shrink-0">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {current.badge_label?.trim() && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase leading-none ${style.badge}`}
                  >
                    {current.badge_label.trim()}
                  </span>
                )}
              </span>

              <p className="truncate leading-snug">{current.message.trim()}</p>

              {promoCode && (
                <button
                  type="button"
                  onClick={() => void handleCopyPromo()}
                  aria-label={`Copy promo code ${promoCode}`}
                  className={`inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-[10px] font-bold tracking-wider uppercase transition ${style.promoBtn}`}
                >
                  {copiedId === current.id ? (
                    <>
                      <Check className="h-2.5 w-2.5" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <span>{promoCode}</span>
                      <Copy className="h-2.5 w-2.5 opacity-75" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}

              {hasCta &&
                (isInternalCta ? (
                  <Link
                    href={ctaUrl}
                    className={`inline-flex shrink-0 items-center gap-0.5 font-bold whitespace-nowrap ${style.ctaLink}`}
                  >
                    <span>{current.cta_label?.trim()}</span>
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                ) : (
                  <a
                    href={ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex shrink-0 items-center gap-0.5 font-bold whitespace-nowrap ${style.ctaLink}`}
                  >
                    <span>{current.cta_label?.trim()}</span>
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </a>
                ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {visibleCount > 1 && (
            <span className="hidden text-[10px] font-semibold opacity-65 tabular-nums sm:inline">
              {(activeIndex % visibleCount) + 1}/{visibleCount}
            </span>
          )}
          {current.is_dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss announcement"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-70 transition hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
