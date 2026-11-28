'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { useShare } from '@/components/ui/ShareSheetModal';
import type { SharePayload } from '@/lib/utils/share';

export interface ShareButtonProps {
  title: string;
  text?: string;
  /** Relative path (e.g., "/listing/123") or full URL */
  url?: string;
  whatsappMessage?: string;
  imageUrl?: string | null;
  categoryLabel?: string | null;
  category?: string | null;
  verticalBadge?: string | null;
  locality?: string | null;
  priceLabel?: string | null;
  priceText?: string | null;
  rating?: number | null;
  isVerified?: boolean;
  verified?: boolean;
  subtitle?: string | null;
  sharePayload?: SharePayload;
  label?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
}

export function ShareButton({
  title,
  text,
  url,
  whatsappMessage,
  imageUrl,
  categoryLabel,
  category,
  verticalBadge,
  locality,
  priceLabel,
  priceText,
  rating,
  isVerified,
  verified,
  subtitle,
  sharePayload,
  label = 'Share',
  compact = false,
  className = '',
  testId,
}: ShareButtonProps) {
  const { openShareSheet } = useShare();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rawUrl = sharePayload?.url ?? url;
    const resolvedUrl =
      rawUrl && rawUrl.startsWith('/') && typeof window !== 'undefined'
        ? `${window.location.origin}${rawUrl}`
        : rawUrl;

    const payload: SharePayload = {
      title: sharePayload?.title ?? title,
      text: sharePayload?.text ?? text,
      url: resolvedUrl,
      whatsappMessage: sharePayload?.whatsappMessage ?? whatsappMessage,
      imageUrl: sharePayload?.imageUrl ?? imageUrl,
      categoryLabel: sharePayload?.categoryLabel ?? sharePayload?.category ?? categoryLabel ?? category,
      verticalBadge: sharePayload?.verticalBadge ?? verticalBadge,
      locality: sharePayload?.locality ?? locality,
      priceLabel: sharePayload?.priceLabel ?? sharePayload?.priceText ?? priceLabel ?? priceText,
      rating: sharePayload?.rating ?? rating,
      isVerified: sharePayload?.isVerified ?? sharePayload?.verified ?? isVerified ?? verified,
      subtitle: sharePayload?.subtitle ?? subtitle,
    };
    openShareSheet(payload);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        data-testid={testId}
        className={`inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0 ${className}`}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      data-testid={testId}
      className={`inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0 ${className}`}
    >
      <Share2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default ShareButton;

