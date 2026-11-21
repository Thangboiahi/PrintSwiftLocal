'use client';

import React, { useId } from 'react';

export interface DDoodleLogoProps {
  variant?: 'mark' | 'wordmark' | 'full';
  size?: number;
  showTagline?: boolean;
  className?: string;
}

export function DDoodleLogo({
  variant = 'full',
  size = 28,
  showTagline,
  className = '',
}: DDoodleLogoProps) {
  const uniqueId = useId().replace(/:/g, '');
  const tealId = `dd-teal-${uniqueId}`;
  const goldId = `dd-gold-${uniqueId}`;

  const renderMark = () => (
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

  if (variant === 'mark') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`}>
        {renderMark()}
      </span>
    );
  }

  const shouldShowTagline = showTagline ?? variant === 'full';

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {renderMark()}
      <div className="flex flex-col justify-center leading-none">
        <span className="font-extrabold tracking-tight leading-none text-base sm:text-lg select-none">
          <span className="text-[#C89B32] dark:text-[#E5BD57]">DD</span>{' '}
          <span className="text-slate-900 dark:text-white">oodle</span>
        </span>
        {shouldShowTagline && (
          <span className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wide mt-0.5 select-none">
            Your Daily Discovery
          </span>
        )}
      </div>
    </div>
  );
}

export default DDoodleLogo;
