'use client';

import React from 'react';
import { ArrowRightLeft, Loader2, MapPin } from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';

export interface CrossHubBannerProps {
  itemHubId?: string | null;
  itemTypeLabel?: string;
  className?: string;
}

export function CrossHubBanner({
  itemHubId,
  itemTypeLabel = 'item',
  className = '',
}: CrossHubBannerProps) {
  const { hubs, activeHub, isSwitchingHub, switchHub } = useHub();

  const cleanItemHubId = (itemHubId || '').trim();
  if (!cleanItemHubId || !activeHub?.id || cleanItemHubId === activeHub.id) {
    return null;
  }

  const targetHub = hubs.find(
    (h) =>
      h.id === cleanItemHubId ||
      h.slug.toLowerCase() === cleanItemHubId.toLowerCase()
  );

  if (!targetHub || targetHub.id === activeHub.id) {
    return null;
  }

  const canSwitch = targetHub.status === 'active';

  return (
    <div
      role="region"
      aria-label="Cross-hub location notice"
      data-testid="cross-hub-banner"
      className={`w-full rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${className}`.trim()}
    >
      <div className="flex items-center gap-2 min-w-0 text-amber-900 dark:text-amber-200 font-medium">
        <MapPin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>
          This {itemTypeLabel} is located in{' '}
          <strong className="font-bold">{targetHub.name}</strong>.
        </span>
      </div>

      {canSwitch && (
        <button
          type="button"
          disabled={isSwitchingHub}
          data-testid={`cross-hub-switch-btn-${targetHub.slug}`}
          onClick={() => void switchHub(targetHub.slug)}
          className="h-7 px-2.5 rounded-lg bg-theme-primary text-theme-primary-foreground text-[11px] font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60 transition-opacity shrink-0 cursor-pointer"
        >
          {isSwitchingHub ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <ArrowRightLeft className="w-3 h-3" />
          )}
          <span>Switch to {targetHub.name} Hub</span>
        </button>
      )}
    </div>
  );
}

export default CrossHubBanner;
