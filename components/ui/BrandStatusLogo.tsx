'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Check,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import {
  APP_STATUS_LABELS,
  useAppStatus,
  type AppStatusType,
} from '@/lib/hooks/useAppStatus';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { HubSwitcherPill } from '@/components/hub/HubSwitcherPill';

export type BrandStatusType = AppStatusType;

export interface BrandStatusLogoProps {
  status?: BrandStatusType;
  statusText?: string;
  className?: string;
  hideTextOnIdle?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  asButton?: boolean;
}

function getStatusPillTheme(status: AppStatusType): {
  pillClass: string;
  icon: 'spinner' | 'check' | 'offline' | 'error';
} {
  switch (status) {
    case 'success':
      return {
        pillClass:
          'bg-emerald-100/90 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70',
        icon: 'check',
      };
    case 'offline':
      return {
        pillClass:
          'bg-amber-100/90 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70',
        icon: 'offline',
      };
    case 'error':
      return {
        pillClass:
          'bg-rose-100/90 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70',
        icon: 'error',
      };
    default:
      return {
        pillClass:
          'bg-blue-100/90 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/70',
        icon: 'spinner',
      };
  }
}

function BrandStatusLogoInner({
  status: propStatus,
  statusText: propStatusText,
  className = '',
  hideTextOnIdle = false,
  onClick,
  asButton = false,
}: BrandStatusLogoProps) {
  const [mounted, setMounted] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { status: appStatus, label: appLabel } = useAppStatus();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Turn OFF route loading when route changes finish
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsRouteLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  // Intercept internal link clicks to provide instant route transition feedback
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (
        target &&
        target.href &&
        target.href.startsWith(window.location.origin) &&
        target.target !== '_blank'
      ) {
        const currentUrl = window.location.href.split('#')[0];
        const targetUrl = target.href.split('#')[0];
        if (currentUrl !== targetUrl) {
          setIsRouteLoading(true);
        }
      }
    };

    document.addEventListener('click', handleLinkClick);
    return () => {
      document.removeEventListener('click', handleLinkClick);
    };
  }, []);

  // Strictly 'idle' before client mount so server and client HTML always match
  let effectiveStatus: AppStatusType = 'idle';
  let effectiveLabel = '';

  if (mounted) {
    if (propStatus && propStatus !== 'idle') {
      effectiveStatus = propStatus;
      effectiveLabel =
        propStatusText?.trim() || APP_STATUS_LABELS[propStatus] || '';
    } else if (appStatus !== 'idle') {
      effectiveStatus = appStatus;
      effectiveLabel = appLabel || APP_STATUS_LABELS[appStatus] || '';
    } else if (isRouteLoading) {
      effectiveStatus = 'fetching_listings';
      effectiveLabel = 'Loading';
    }
  }

  const { identity } = useAppConfig();
  const isActiveStatus = mounted && effectiveStatus !== 'idle';
  const pillTheme = getStatusPillTheme(effectiveStatus);
  const showLogoSpinner = isActiveStatus && pillTheme.icon === 'spinner';
  const isButton = Boolean(asButton || onClick);

  const brandShortName = mounted
    ? identity.short_name?.trim() || identity.app_name?.trim() || 'PrintSwift'
    : 'PrintSwift';
  const brandFullName = mounted
    ? identity.app_name?.trim() || 'PrintSwift Local'
    : 'PrintSwift Local';
  const logoLightUrl = mounted ? identity.logo_light_url?.trim() || null : null;
  const logoDarkUrl = mounted ? identity.logo_dark_url?.trim() || null : null;
  const hasCustomLogo = Boolean(logoLightUrl || logoDarkUrl);

  const logoIcon = (
    <div className="relative flex items-center justify-center p-0.5 shrink-0">
      {!mounted ? (
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-xs">
          <MapPin
            size={16}
            strokeWidth={2.5}
            className="sm:w-[17px] sm:h-[17px]"
          />
        </div>
      ) : (
        <>
          {showLogoSpinner && (
            <motion.div
              data-testid="logo-status-active"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
              className="absolute inset-0 rounded-full border-[2.5px] border-blue-600/25 dark:border-blue-400/25 border-t-blue-600 dark:border-t-blue-400"
            />
          )}
          {hasCustomLogo ? (
            <div
              className={`relative z-10 flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-xs transition-transform duration-300 ${
                showLogoSpinner ? 'scale-90' : 'group-hover:scale-105'
              }`}
            >
              {logoLightUrl && (
                <img
                  src={logoLightUrl}
                  alt={brandFullName}
                  referrerPolicy="no-referrer"
                  className={`w-full h-full object-contain p-0.5 ${
                    logoDarkUrl ? 'dark:hidden' : ''
                  }`}
                />
              )}
              {logoDarkUrl && (
                <img
                  src={logoDarkUrl}
                  alt={brandFullName}
                  referrerPolicy="no-referrer"
                  className={`w-full h-full object-contain p-0.5 ${
                    logoLightUrl ? 'hidden dark:block' : ''
                  }`}
                />
              )}
            </div>
          ) : (
            <div
              className={`relative z-10 flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 text-white shadow-xs transition-transform duration-300 ${
                showLogoSpinner ? 'scale-90' : 'group-hover:scale-105'
              }`}
            >
              <MapPin
                size={16}
                strokeWidth={2.5}
                className="sm:w-[17px] sm:h-[17px]"
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  const containerClasses = `flex items-center justify-center gap-1.5 sm:gap-2 group outline-none shrink-0 transition-colors ${className}`;

  if (isButton) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={brandFullName}
        title={`${brandShortName} Home & Reveal Header`}
        className={containerClasses}
      >
        {logoIcon}
        {hideTextOnIdle && mounted && (
          <AnimatePresence initial={false}>
            {isActiveStatus && effectiveLabel && (
              <motion.span
                key={`map-status-pill-${effectiveStatus}`}
                data-testid="brand-status-pill"
                data-status={effectiveStatus}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`inline-flex items-center gap-1 mr-1.5 px-1.5 py-0.5 rounded-full border text-[10px] leading-none font-semibold whitespace-nowrap max-w-[120px] ${pillTheme.pillClass}`}
              >
                {pillTheme.icon === 'check' && (
                  <Check className="w-3 h-3 shrink-0" />
                )}
                {pillTheme.icon === 'offline' && (
                  <WifiOff className="w-3 h-3 shrink-0" />
                )}
                {pillTheme.icon === 'error' && (
                  <AlertCircle className="w-3 h-3 shrink-0" />
                )}
                <motion.span
                  animate={
                    pillTheme.icon === 'spinner'
                      ? { opacity: [0.4, 1, 0.4] }
                      : { opacity: 1 }
                  }
                  transition={
                    pillTheme.icon === 'spinner'
                      ? {
                          duration: 1.4,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                      : { duration: 0.15 }
                  }
                  className="truncate"
                >
                  {effectiveLabel}
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </button>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Icon links to Home */}
      <Link
        href="/"
        aria-label={`${brandFullName} Home`}
        className="outline-none flex items-center justify-center cursor-pointer"
      >
        {logoIcon}
      </Link>

      {/* Brand Text & Status / Hub Dropdown Pill Column */}
      {!hideTextOnIdle ? (
        <div className="relative flex flex-col justify-center h-9 min-w-0 text-left pl-0.5 pr-1.5 select-none">
          {/* Brand Name links to Home */}
          <Link
            href="/"
            aria-label={`${brandFullName} Home`}
            className="outline-none block leading-none"
          >
            <motion.span
              initial={false}
              animate={{
                y: -6,
                scale: 0.82,
              }}
              style={{ transformOrigin: 'left center' }}
              className="whitespace-nowrap font-bold tracking-tight text-slate-900 dark:text-white text-base sm:text-lg leading-none block hover:opacity-90 transition-opacity"
            >
              {brandShortName}
            </motion.span>
          </Link>

          {/* Status Pill when Active, OR Hub Switcher Dropdown Trigger when Idle */}
          {mounted && (
            <AnimatePresence mode="wait" initial={false}>
              {isActiveStatus && effectiveLabel ? (
                <motion.span
                  key={`status-pill-${effectiveStatus}`}
                  data-testid="brand-status-pill"
                  data-status={effectiveStatus}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={`pointer-events-none absolute left-0.5 bottom-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] leading-none font-semibold whitespace-nowrap max-w-[140px] sm:max-w-[175px] shadow-2xs ${pillTheme.pillClass}`}
                >
                  {pillTheme.icon === 'check' && (
                    <Check className="w-2.5 h-2.5 shrink-0" />
                  )}
                  {pillTheme.icon === 'offline' && (
                    <WifiOff className="w-2.5 h-2.5 shrink-0" />
                  )}
                  {pillTheme.icon === 'error' && (
                    <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                  )}
                  <motion.span
                    animate={
                      pillTheme.icon === 'spinner'
                        ? { opacity: [0.4, 1, 0.4] }
                        : { opacity: 1 }
                    }
                    transition={
                      pillTheme.icon === 'spinner'
                        ? {
                            duration: 1.4,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }
                        : { duration: 0.15 }
                    }
                    className="truncate"
                  >
                    {effectiveLabel}
                  </motion.span>
                </motion.span>
              ) : (
                <motion.div
                  key="brand-hub-idle-pill"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0.5 bottom-0 z-20 flex items-center min-w-0"
                >
                  <HubSwitcherPill variant="logo-pill" />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      ) : (
        /* On-Map Floating Logo */
        mounted && (
          <AnimatePresence initial={false}>
            {isActiveStatus && effectiveLabel && (
              <motion.span
                key={`map-status-pill-${effectiveStatus}`}
                data-testid="brand-status-pill"
                data-status={effectiveStatus}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`inline-flex items-center gap-1 mr-1.5 px-1.5 py-0.5 rounded-full border text-[10px] leading-none font-semibold whitespace-nowrap max-w-[120px] ${pillTheme.pillClass}`}
              >
                {pillTheme.icon === 'check' && (
                  <Check className="w-3 h-3 shrink-0" />
                )}
                {pillTheme.icon === 'offline' && (
                  <WifiOff className="w-3 h-3 shrink-0" />
                )}
                {pillTheme.icon === 'error' && (
                  <AlertCircle className="w-3 h-3 shrink-0" />
                )}
                <motion.span
                  animate={
                    pillTheme.icon === 'spinner'
                      ? { opacity: [0.4, 1, 0.4] }
                      : { opacity: 1 }
                  }
                  transition={
                    pillTheme.icon === 'spinner'
                      ? {
                          duration: 1.4,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                      : { duration: 0.15 }
                  }
                  className="truncate"
                >
                  {effectiveLabel}
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        )
      )}
    </div>
  );
}

function BrandStatusLogoFallback({
  hideTextOnIdle,
}: {
  hideTextOnIdle?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-xs p-0.5">
        <MapPin
          size={16}
          strokeWidth={2.5}
          className="sm:w-[17px] sm:h-[17px]"
        />
      </div>
      {!hideTextOnIdle && (
        <span className="font-bold text-slate-900 dark:text-white text-lg sm:text-xl tracking-tight leading-none">
          PrintSwift
        </span>
      )}
    </div>
  );
}

export function BrandStatusLogo(props: BrandStatusLogoProps) {
  return (
    <Suspense
      fallback={
        <BrandStatusLogoFallback hideTextOnIdle={props.hideTextOnIdle} />
      }
    >
      <BrandStatusLogoInner {...props} />
    </Suspense>
  );
}

export { BrandStatusLogo as BrandLogoStatus };
export default BrandStatusLogo;
