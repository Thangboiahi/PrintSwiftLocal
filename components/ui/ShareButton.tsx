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
  label = 'Share',
  compact = false,
  className = '',
  testId,
}: ShareButtonProps) {
  const { share } = useShare();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const resolvedUrl =
      url && url.startsWith('/') && typeof window !== 'undefined'
        ? `${window.location.origin}${url}`
        : url;

    const payload: SharePayload = {
      title,
      text,
      url: resolvedUrl,
      whatsappMessage,
    };
    void share(payload);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        data-testid={testId}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0 ${className}`}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      data-testid={testId}
      className={`inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0 ${className}`}
    >
      <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export default ShareButton;
