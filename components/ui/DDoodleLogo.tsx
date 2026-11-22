'use client';

import React, { useId, useMemo } from 'react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { sanitizeSvgMarkup } from '@/lib/brand/sanitize-svg';
import type { AppIdentityConfig } from '@/lib/config/types';

export interface DDoodleLogoProps {
  variant?: 'icon' | 'mark' | 'wordmark' | 'full';
  size?: number;
  showTagline?: boolean;
  className?: string;
  /** Optional preview override used by Super-Admin brand editor */
  overrideIdentity?: Partial<AppIdentityConfig>;
  /** Force default native DD oodle vector emblem (ignores custom overrides) */
  forceDefault?: boolean;
}

function renderBrandWordmarkText(brandName: string) {
  const trimmed = brandName.trim() || 'DD oodle';
  if (/^dd\s+oodle$/i.test(trimmed)) {
    return (
      <>
        <span className="text-[#C89B32] dark:text-[#E5BD57]">DD</span>{' '}
        <span className="text-[var(--ps-text)]">oodle</span>
      </>
    );
  }
  return <span className="text-[var(--ps-text)]">{trimmed}</span>;
}

export function DDoodleLogo({
  variant = 'full',
  size = 28,
  showTagline,
  className = '',
  overrideIdentity,
  forceDefault = false,
}: DDoodleLogoProps) {
  const uniqueId = useId().replace(/:/g, '');
  const tealId = `dd-teal-${uniqueId}`;
  const goldId = `dd-gold-${uniqueId}`;
  const { identity: ctxIdentity } = useAppConfig();

  const identity = useMemo(() => {
    if (!overrideIdentity) return ctxIdentity;
    return { ...ctxIdentity, ...overrideIdentity };
  }, [ctxIdentity, overrideIdentity]);

  const brandName =
    identity.short_name?.trim() || identity.app_name?.trim() || 'DD oodle';
  const brandTagline = identity.tagline?.trim() || 'Your Daily Discovery';
  const logoMode = forceDefault ? 'default' : (identity.logo_mode ?? 'default');

  const safeCustomIconSvg = useMemo(() => {
    if (forceDefault) return null;
    if (logoMode !== 'svg' && !identity.custom_icon_svg && !identity.custom_logo_svg) {
      return null;
    }
    if (logoMode === 'image_url') return null;
    const raw = identity.custom_icon_svg || identity.custom_logo_svg;
    return raw ? sanitizeSvgMarkup(raw) : null;
  }, [forceDefault, logoMode, identity.custom_icon_svg, identity.custom_logo_svg]);

  const safeCustomFullSvg = useMemo(() => {
    if (forceDefault || logoMode !== 'svg') return null;
    const raw = identity.custom_logo_svg;
    return raw ? sanitizeSvgMarkup(raw) : null;
  }, [forceDefault, logoMode, identity.custom_logo_svg]);

  const customLightImg = useMemo(() => {
    if (forceDefault) return null;
    if (logoMode === 'svg') return null;
    if (logoMode === 'default' && !identity.logo_light_url && !identity.logo_dark_url && !identity.logo_url) {
      return null;
    }
    if (logoMode === 'default') return null;
    return (
      identity.logo_light_url?.trim() ||
      identity.logo_url?.trim() ||
      identity.logo_dark_url?.trim() ||
      null
    );
  }, [forceDefault, logoMode, identity.logo_light_url, identity.logo_url, identity.logo_dark_url]);

  const customDarkImg = useMemo(() => {
    if (forceDefault || logoMode !== 'image_url') return null;
    return (
      identity.logo_dark_url?.trim() ||
      identity.logo_url?.trim() ||
      identity.logo_light_url?.trim() ||
      null
    );
  }, [forceDefault, logoMode, identity.logo_dark_url, identity.logo_url, identity.logo_light_url]);

  const renderDefaultMark = () => (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0 transition-transform duration-200 group-hover:scale-105"
    >
      <defs>
        <linearGradient
          id={tealId}
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
          id={goldId}
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
      </defs>

      {/* Left Forest-Teal Pin */}
      <path
        d="M19 15C12.9249 15 8 19.9249 8 26C8 34.2 19 50 19 50C19 50 30 34.2 30 26C30 19.9249 25.0751 15 19 15Z"
        fill={`url(#${tealId})`}
      />

      {/* Subtle Left Pin Depth Facet */}
      <path
        d="M19 15V50C19 50 30 34.2 30 26C30 19.9249 25.0751 15 19 15Z"
        fill="#092E30"
        fillOpacity="0.22"
      />

      {/* Left Pin Gold Dot */}
      <circle cx="19" cy="26" r="4.3" fill={`url(#${goldId})`} />

      {/* Connecting S-Curve Pathway */}
      <path
        d="M19 50C25.2 46.8 29.1 40.6 30.8 32.4C31.8 27.3 33.2 22.3 36.6 18.8L40.5 22.5L36.5 34C34.2 43.2 28.2 50.4 19 50Z"
        fill={`url(#${goldId})`}
      />

      {/* Right Gold Pin */}
      <path
        d="M45 15C38.9249 15 34 19.9249 34 26C34 34.2 45 50 45 50C45 50 56 34.2 56 26C56 19.9249 51.0751 15 45 15Z"
        fill={`url(#${goldId})`}
      />

      {/* Subtle Right Pin Depth Facet */}
      <path
        d="M45 15V50C45 50 56 34.2 56 26C56 19.9249 51.0751 15 45 15Z"
        fill="#8C6414"
        fillOpacity="0.18"
      />

      {/* Right Pin Crisp White Dot */}
      <circle cx="45" cy="26" r="4.3" fill="#FFFFFF" />
    </svg>
  );

  const renderMark = () => {
    if (logoMode === 'svg' && safeCustomIconSvg) {
      return (
        <span
          aria-hidden="true"
          style={{ width: size, height: size }}
          className="inline-flex shrink-0 items-center justify-center overflow-hidden [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: safeCustomIconSvg }}
        />
      );
    }

    if (logoMode === 'image_url' && (customLightImg || customDarkImg)) {
      const hasDistinctPair =
        Boolean(customLightImg && customDarkImg && customLightImg !== customDarkImg);
      return (
        <span
          style={{ width: size, height: size }}
          className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg"
        >
          {customLightImg && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={customLightImg}
              alt={brandName}
              referrerPolicy="no-referrer"
              className={`h-full w-full object-contain ${
                hasDistinctPair ? 'dark:hidden' : ''
              }`}
            />
          )}
          {hasDistinctPair && customDarkImg && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={customDarkImg}
              alt={brandName}
              referrerPolicy="no-referrer"
              className="hidden h-full w-full object-contain dark:block"
            />
          )}
        </span>
      );
    }

    return renderDefaultMark();
  };

  if (variant === 'mark' || variant === 'icon') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
      >
        {renderMark()}
      </span>
    );
  }

  const shouldShowTagline = showTagline ?? variant === 'full';

  // When Super-Admin provides a dedicated horizontal full-logo SVG, render it cleanly for `full`
  if (variant === 'full' && logoMode === 'svg' && safeCustomFullSvg && !identity.custom_icon_svg) {
    return (
      <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
        <span
          aria-label={brandName}
          style={{ height: Math.max(size, 32), maxWidth: Math.max(size * 4.5, 160) }}
          className="inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-auto"
          dangerouslySetInnerHTML={{ __html: safeCustomFullSvg }}
        />
        {shouldShowTagline && (
          <span className="text-[11px] font-medium text-[var(--ps-text-muted)] tracking-wide select-none">
            {brandTagline}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {renderMark()}
      <div className="flex flex-col justify-center leading-none">
        <span className="font-extrabold tracking-tight leading-none text-base sm:text-lg select-none">
          {renderBrandWordmarkText(brandName)}
        </span>
        {shouldShowTagline && (
          <span className="text-[10px] sm:text-xs font-medium text-[var(--ps-text-muted)] tracking-wide mt-0.5 select-none">
            {brandTagline}
          </span>
        )}
      </div>
    </div>
  );
}

export default DDoodleLogo;
