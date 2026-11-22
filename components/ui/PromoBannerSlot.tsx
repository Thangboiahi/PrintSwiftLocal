'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Megaphone,
  Sparkles,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type {
  AppBannerPlacement,
  AppBannerRecord,
  AppBannerThemeStyle,
} from '@/lib/config/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface PromoBannerSlotProps {
  placement: AppBannerPlacement;
  compact?: boolean;
  className?: string;
}

const IMPRESSION_SESSION_PREFIX = 'printswift_banner_imp_';
const AUTO_ADVANCE_MS = 7000;

function isSafeTargetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  );
}

function isBannerLive(banner: AppBannerRecord, nowMs: number): boolean {
  if (!banner.is_active || !banner.title.trim()) return false;
  if (banner.starts_at) {
    const startMs = Date.parse(banner.starts_at);
    if (!Number.isNaN(startMs) && startMs > nowMs) return false;
  }
  if (banner.expires_at) {
    const endMs = Date.parse(banner.expires_at);
    if (!Number.isNaN(endMs) && endMs <= nowMs) return false;
  }
  return true;
}

const BANNER_THEME_STYLES: Record<
  AppBannerThemeStyle,
  {
    card: string;
    badge: string;
    title: string;
    subtitle: string;
    sponsor: string;
    promoBtn: string;
    ctaBtn: string;
    navBtn: string;
    dotActive: string;
    dotInactive: string;
  }
> = {
  clean: {
    card: 'bg-white border-slate-200/90 shadow-sm dark:bg-slate-900 dark:border-slate-800',
    badge:
      'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    title: 'text-slate-950 dark:text-white',
    subtitle: 'text-slate-600 dark:text-slate-300',
    sponsor: 'text-slate-500 dark:text-slate-400',
    promoBtn:
      'bg-slate-100 hover:bg-slate-200/80 text-slate-900 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700',
    ctaBtn:
      'bg-theme-primary text-theme-primary-foreground hover:opacity-95 shadow-xs',
    navBtn:
      'bg-slate-100/90 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200',
    dotActive: 'bg-theme-primary',
    dotInactive: 'bg-slate-300 dark:bg-slate-700',
  },
  primary: {
    card: 'bg-gradient-to-br from-[color-mix(in_srgb,hsl(var(--color-primary))_14%,white)] via-white to-[color-mix(in_srgb,hsl(var(--color-accent))_10%,white)] border-[color-mix(in_srgb,hsl(var(--color-primary))_32%,transparent)] shadow-sm dark:from-[color-mix(in_srgb,hsl(var(--color-primary))_26%,#0f172a)] dark:via-slate-900 dark:to-slate-900 dark:border-[color-mix(in_srgb,hsl(var(--color-primary))_42%,transparent)]',
    badge: 'bg-theme-primary text-theme-primary-foreground border border-transparent',
    title: 'text-slate-950 dark:text-white',
    subtitle: 'text-slate-700 dark:text-slate-200',
    sponsor: 'text-slate-600 dark:text-slate-400',
    promoBtn:
      'bg-white/90 hover:bg-white text-slate-900 border border-slate-300 dark:bg-slate-800/90 dark:hover:bg-slate-800 dark:text-white dark:border-slate-600',
    ctaBtn:
      'bg-theme-primary text-theme-primary-foreground hover:opacity-95 shadow-sm',
    navBtn:
      'bg-white/80 hover:bg-white text-slate-800 border border-slate-200/80 dark:bg-slate-800/80 dark:hover:bg-slate-800 dark:text-slate-100 dark:border-slate-700',
    dotActive: 'bg-theme-primary',
    dotInactive: 'bg-slate-400/50 dark:bg-slate-600',
  },
  festive: {
    card: 'bg-gradient-to-br from-amber-50 via-orange-50/70 to-amber-100/80 border-amber-300/80 shadow-sm dark:from-amber-950/75 dark:via-orange-950/60 dark:to-slate-900 dark:border-amber-700/60',
    badge:
      'bg-amber-500 text-amber-950 border border-amber-600/20 font-extrabold',
    title: 'text-amber-950 dark:text-amber-50',
    subtitle: 'text-amber-900/85 dark:text-amber-200/90',
    sponsor: 'text-amber-800/80 dark:text-amber-300/80',
    promoBtn:
      'bg-white/90 hover:bg-white text-amber-950 border border-amber-400/60 dark:bg-amber-900/50 dark:hover:bg-amber-900/80 dark:text-amber-100 dark:border-amber-600/50',
    ctaBtn:
      'bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-slate-950 shadow-xs',
    navBtn:
      'bg-amber-200/70 hover:bg-amber-200 text-amber-950 dark:bg-amber-900/70 dark:hover:bg-amber-800 dark:text-amber-100',
    dotActive: 'bg-amber-600 dark:bg-amber-400',
    dotInactive: 'bg-amber-300 dark:bg-amber-800',
  },
  dark: {
    card: 'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border-slate-700/90 shadow-md',
    badge:
      'bg-white/15 text-amber-200 border border-white/20',
    title: 'text-white',
    subtitle: 'text-slate-200',
    sponsor: 'text-slate-400',
    promoBtn:
      'bg-white/10 hover:bg-white/20 text-white border border-white/25',
    ctaBtn:
      'bg-white hover:bg-slate-100 text-slate-950 shadow-xs',
    navBtn:
      'bg-white/10 hover:bg-white/20 text-white',
    dotActive: 'bg-white',
    dotInactive: 'bg-white/30',
  },
};

export function PromoBannerSlot({
  placement,
  compact = false,
  className = '',
}: PromoBannerSlotProps) {
  const { banners } = useAppConfig();
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [isPaused, setIsPaused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  const slotBanners = useMemo(() => {
    return banners.filter(
      (b) => b.placement === placement && isBannerLive(b, nowMs)
    );
  }, [banners, placement, nowMs]);

  const count = slotBanners.length;
  const activeBanner = count > 0 ? slotBanners[activeIndex % count] : null;
  const activeBannerId = activeBanner?.id ?? null;

  const trackMetric = useCallback(
    (bannerId: string, metric: 'impression' | 'click') => {
      if (!isSupabaseConfigured() || !bannerId) return;
      void supabase
        .rpc('track_banner_metric', {
          p_banner_id: bannerId,
          p_metric: metric,
        })
        .then(() => undefined, () => undefined);
    },
    []
  );

  // Fire 1 impression per banner per session when slot enters viewport
  useEffect(() => {
    if (!activeBannerId || !containerRef.current) return;
    const node = containerRef.current;

    const recordImpressionOnce = () => {
      if (trackedRef.current.has(activeBannerId)) return;
      const storageKey = `${IMPRESSION_SESSION_PREFIX}${activeBannerId}`;
      try {
        if (window.sessionStorage.getItem(storageKey) === '1') {
          trackedRef.current.add(activeBannerId);
          return;
        }
        window.sessionStorage.setItem(storageKey, '1');
      } catch {
        // Proceed with in-memory dedupe
      }
      trackedRef.current.add(activeBannerId);
      trackMetric(activeBannerId, 'impression');
    };

    if (typeof IntersectionObserver === 'undefined') {
      recordImpressionOnce();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          recordImpressionOnce();
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [activeBannerId, trackMetric]);

  // Auto-advance carousel if multiple banners share this placement
  useEffect(() => {
    if (count <= 1 || isPaused) return;
    const timer = window.setInterval(() => {
      setDirection(1);
      setActiveIndex((prev) => (prev + 1) % count);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [count, isPaused]);

  if (!activeBanner) {
    return null;
  }

  const theme =
    BANNER_THEME_STYLES[activeBanner.theme_style] ?? BANNER_THEME_STYLES.clean;
  const promoCode = activeBanner.promo_code?.trim().toUpperCase() || '';
  const hasImage = Boolean(
    activeBanner.image_url?.trim() && !failedImages[activeBanner.id]
  );
  const safeTarget = isSafeTargetUrl(activeBanner.target_url)
    ? activeBanner.target_url.trim()
    : '/explore';
  const isInternalLink = safeTarget.startsWith('/');
  const ctaText = activeBanner.cta_label?.trim() || 'Learn More';

  const handleCopyPromo = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!promoCode) return;
    try {
      await navigator.clipboard.writeText(promoCode);
    } catch {
      // Ignore clipboard failures
    }
    setCopiedId(activeBanner.id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === activeBanner.id ? null : prev));
    }, 2000);
  };

  const handleStep = (delta: 1 | -1) => {
    setDirection(delta);
    setActiveIndex((prev) => (prev + delta + count) % count);
  };

  const handleCtaClick = () => {
    trackMetric(activeBanner.id, 'click');
  };

  return (
    <div
      ref={containerRef}
      data-testid={`promo-banner-slot-${placement}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`relative w-full ${className}`}
    >
      <div
        className={`relative overflow-hidden rounded-2xl border transition-colors ${theme.card}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeBanner.id}
            initial={{ opacity: 0, x: direction * 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -18 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className={
              compact
                ? 'flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between'
                : 'flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4'
            }
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {hasImage && (
                <div
                  className={`relative shrink-0 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 ${
                    compact
                      ? 'h-14 w-20 sm:h-16 sm:w-24'
                      : 'h-16 w-24 sm:h-20 sm:w-32'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeBanner.image_url!}
                    alt={activeBanner.title}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={() =>
                      setFailedImages((prev) => ({
                        ...prev,
                        [activeBanner.id]: true,
                      }))
                    }
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  {activeBanner.badge_text?.trim() && (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase leading-none ${theme.badge}`}
                    >
                      {activeBanner.theme_style === 'festive' ? (
                        <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : (
                        <Megaphone className="h-2.5 w-2.5" aria-hidden="true" />
                      )}
                      {activeBanner.badge_text.trim()}
                    </span>
                  )}
                  {activeBanner.sponsor_name?.trim() && (
                    <span className={`truncate text-[10px] font-medium ${theme.sponsor}`}>
                      by {activeBanner.sponsor_name.trim()}
                    </span>
                  )}
                </div>

                <h3
                  className={`font-bold leading-snug ${
                    compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
                  } ${theme.title}`}
                >
                  {activeBanner.title}
                </h3>

                {activeBanner.subtitle?.trim() && (
                  <p
                    className={`mt-0.5 line-clamp-2 leading-snug ${
                      compact ? 'text-[11px]' : 'text-xs'
                    } ${theme.subtitle}`}
                  >
                    {activeBanner.subtitle.trim()}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
              {promoCode && (
                <button
                  type="button"
                  onClick={(e) => void handleCopyPromo(e)}
                  aria-label={`Copy promo code ${promoCode}`}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] font-bold tracking-wider uppercase transition ${theme.promoBtn}`}
                >
                  {copiedId === activeBanner.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <span>{promoCode}</span>
                      <Copy className="h-3 w-3 opacity-75" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}

              {isInternalLink ? (
                <Link
                  href={safeTarget}
                  onClick={handleCtaClick}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold whitespace-nowrap transition ${theme.ctaBtn}`}
                >
                  <span>{ctaText}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : (
                <a
                  href={safeTarget}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleCtaClick}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold whitespace-nowrap transition ${theme.ctaBtn}`}
                >
                  <span>{ctaText}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {count > 1 && (
          <div className="flex items-center justify-between border-t border-black/5 px-3 py-1.5 dark:border-white/10">
            <div className="flex items-center gap-1.5">
              {slotBanners.map((b, idx) => {
                const isCurrent = idx === activeIndex % count;
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`Show banner ${idx + 1} of ${count}`}
                    onClick={() => {
                      setDirection(idx > activeIndex % count ? 1 : -1);
                      setActiveIndex(idx);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      isCurrent ? `w-5 ${theme.dotActive}` : `w-1.5 ${theme.dotInactive}`
                    }`}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous banner"
                onClick={() => handleStep(-1)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${theme.navBtn}`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next banner"
                onClick={() => handleStep(1)}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${theme.navBtn}`}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
