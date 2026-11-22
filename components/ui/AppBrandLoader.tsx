'use client';

import React, { useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';

export interface AppBrandLoaderProps {
  mode?: 'fullscreen' | 'inline';
  message?: string;
  className?: string;
}

export function AppBrandLoader({
  mode = 'fullscreen',
  message,
  className = '',
}: AppBrandLoaderProps) {
  const uniqueId = useId().replace(/:/g, '');
  const tealGradId = `loader-teal-${uniqueId}`;
  const goldGradId = `loader-gold-${uniqueId}`;
  const glowGradId = `loader-glow-${uniqueId}`;
  const { identity } = useAppConfig();

  const hasCustomLogo =
    (identity.logo_mode === 'svg' &&
      Boolean(identity.custom_icon_svg || identity.custom_logo_svg)) ||
    (identity.logo_mode === 'image_url' &&
      Boolean(identity.logo_url || identity.logo_light_url || identity.logo_dark_url));
  const brandName =
    identity.short_name?.trim() || identity.app_name?.trim() || 'DD oodle';
  const brandTagline = identity.tagline?.trim() || 'Your Daily Discovery';

  const containerClasses =
    mode === 'fullscreen'
      ? 'fixed inset-0 z-[55] flex flex-col items-center justify-center overflow-hidden px-6 bg-[var(--bg-canvas)]/95 text-[var(--text-primary)] backdrop-blur-sm h-[100dvh] w-full max-w-full'
      : 'w-full max-w-full min-h-[calc(100dvh-140px)] flex flex-col items-center justify-center overflow-hidden px-6 py-10 text-[var(--text-primary)]';

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        aria-label="Loading DD oodle"
        data-testid="app-brand-loader"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className={`${containerClasses} ${className}`}
      >
        <div className="flex flex-col items-center justify-center text-center select-none max-w-sm w-full">
          {/* Animated Map Scene & Connected Pins SVG (or configured Custom Brand Logo) */}
          <div className="relative w-32 h-32 flex items-center justify-center mb-5 shrink-0">
            {hasCustomLogo ? (
              <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 shadow-lg">
                <DDoodleLogo variant="icon" size={56} />
                <motion.div
                  animate={{ scale: [1, 1.25], opacity: [0.4, 0] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-theme-primary/40"
                />
              </div>
            ) : (
            <svg
              viewBox="0 0 140 140"
              className="w-full h-full overflow-visible"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id={tealGradId}
                  x1="8"
                  y1="15"
                  x2="30"
                  y2="50"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#1D7578" />
                  <stop offset="100%" stopColor="#0E4447" />
                </linearGradient>

                <linearGradient
                  id={goldGradId}
                  x1="20"
                  y1="50"
                  x2="56"
                  y2="15"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#C89B32" />
                  <stop offset="55%" stopColor="#E5BD57" />
                  <stop offset="100%" stopColor="#D4A63E" />
                </linearGradient>

                <radialGradient
                  id={glowGradId}
                  cx="50%"
                  cy="50%"
                  r="50%"
                  fx="50%"
                  fy="50%"
                >
                  <stop offset="0%" stopColor="#E5BD57" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#C89B32" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Faint Concentric Discovery Radar Rings */}
              <motion.circle
                cx="70"
                cy="68"
                r="36"
                stroke="#1D7578"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                initial={{ scale: 0.7, opacity: 0.45 }}
                animate={{ scale: 1.35, opacity: 0 }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
              <motion.circle
                cx="70"
                cy="68"
                r="36"
                stroke="#C89B32"
                strokeWidth="1.2"
                strokeDasharray="4 4"
                initial={{ scale: 0.7, opacity: 0.45 }}
                animate={{ scale: 1.35, opacity: 0 }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  delay: 1.2,
                  ease: 'easeOut',
                }}
              />

              {/* Subtle Dotted Map-Route Arcs in Background */}
              <path
                d="M 28 85 C 42 100, 98 100, 112 85"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2 4"
                className="text-slate-300 dark:text-slate-700/60"
              />
              <path
                d="M 32 45 C 50 30, 90 30, 108 45"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2 4"
                className="text-slate-300 dark:text-slate-700/60"
              />

              {/* Scaled & Centered Connected Pins Group (Logo native 64x64 mapped into 140x140) */}
              <g transform="translate(22, 20) scale(1.5)">
                {/* 1. Left Forest-Teal Pin with Drop-in Animation */}
                <motion.g
                  initial={{ y: -10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 24,
                    delay: 0.1,
                  }}
                >
                  <path
                    d="M19 15C12.9249 15 8 19.9249 8 26C8 34.2 19 50 19 50C19 50 30 34.2 30 26C30 19.9249 25.0751 15 19 15Z"
                    fill={`url(#${tealGradId})`}
                  />
                  <path
                    d="M19 15V50C19 50 30 34.2 30 26C30 19.9249 25.0751 15 19 15Z"
                    fill="#092E30"
                    fillOpacity="0.22"
                  />
                  <circle cx="19" cy="26" r="4.3" fill={`url(#${goldGradId})`} />
                </motion.g>

                {/* 2. Connecting Golden S-Curve Map Route Drawing Itself */}
                <motion.path
                  d="M19 50C25.2 46.8 29.1 40.6 30.8 32.4C31.8 27.3 33.2 22.3 36.6 18.8L40.5 22.5L36.5 34C34.2 43.2 28.2 50.4 19 50Z"
                  fill={`url(#${goldGradId})`}
                  initial={{ opacity: 0.3, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    repeatType: 'reverse',
                    ease: 'easeInOut',
                  }}
                />

                {/* Drawn Shimmer Centerline Route Arc */}
                <motion.path
                  d="M 19 46 Q 30 34 38 23"
                  stroke="#FFFFFF"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: [0, 1, 0], opacity: [0, 0.9, 0] }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />

                {/* 3. Right Warm-Gold Pin with Gentle Pulse */}
                <motion.g
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{
                    duration: 2.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  style={{ transformOrigin: '45px 32px' }}
                >
                  <path
                    d="M45 15C38.9249 15 34 19.9249 34 26C34 34.2 45 50 45 50C45 50 56 34.2 56 26C56 19.9249 51.0751 15 45 15Z"
                    fill={`url(#${goldGradId})`}
                  />
                  <path
                    d="M45 15V50C45 50 56 34.2 56 26C56 19.9249 51.0751 15 45 15Z"
                    fill="#8C6414"
                    fillOpacity="0.18"
                  />
                  <circle cx="45" cy="26" r="4.3" fill="#FFFFFF" />

                  {/* Traveling Glowing Route Dot */}
                  <motion.circle
                    cx="45"
                    cy="26"
                    r="6"
                    fill={`url(#${glowGradId})`}
                    animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.4, 1, 0.4] }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                </motion.g>
              </g>
            </svg>
            )}
          </div>

          {/* DD oodle Wordmark + Tagline Lockup */}
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.32, delay: 0.15 }}
            className="space-y-1.5 flex flex-col items-center"
          >
            <div className="text-2xl font-black tracking-tight leading-none">
              {/^dd\s+oodle$/i.test(brandName) ? (
                <>
                  <span className="text-[#C89B32] dark:text-[#E5BD57]">DD</span>{' '}
                  <span className="text-[var(--text-primary)]">oodle</span>
                </>
              ) : (
                <span className="text-[var(--text-primary)]">{brandName}</span>
              )}
            </div>

            <div className="text-xs sm:text-sm font-medium tracking-wide text-[var(--ps-text-muted)]">
              {brandTagline}
            </div>

            {/* Subtle Animated Map-Route Progress Bar */}
            <div className="w-28 h-1 rounded-full bg-[var(--ps-border)] overflow-hidden mt-3 relative">
              <motion.div
                className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#1D7578] via-[#C89B32] to-[#E5BD57] w-1/2"
                initial={{ left: '-50%' }}
                animate={{ left: '100%' }}
                transition={{
                  repeat: Infinity,
                  duration: 1.6,
                  ease: 'easeInOut',
                }}
              />
            </div>

            {message && (
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 pt-2 animate-pulse">
                {message}
              </p>
            )}
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default AppBrandLoader;
