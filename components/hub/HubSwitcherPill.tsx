'use client';

import React, { useState } from 'react';
import { ChevronDown, Loader2, MapPin } from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';
import { UnifiedHubModal } from './UnifiedHubModal';

export interface HubSwitcherPillProps {
  variant?: 'header' | 'drawer' | 'logo-pill';
  onActionComplete?: () => void;
  className?: string;
}

export function HubSwitcherPill({
  variant = 'logo-pill',
  onActionComplete,
  className = '',
}: HubSwitcherPillProps) {
  const { activeHub, isSwitchingHub } = useHub();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsModalOpen(true);
  };

  return (
    <>
      <div className={`relative ${className}`}>
        {variant === 'logo-pill' ? (
          <button
            type="button"
            onClick={handleOpen}
            data-testid="hub-switcher-logo-pill"
            aria-label={`Current service hub: ${activeHub?.name || 'Churachandpur'}. Click to switch hub.`}
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] leading-none font-semibold text-slate-600 dark:text-slate-400 hover:text-theme-primary transition-colors cursor-pointer group/hub select-none py-0.5 outline-none"
          >
            {isSwitchingHub ? (
              <Loader2 className="w-2.5 h-2.5 text-theme-primary animate-spin shrink-0" />
            ) : (
              <MapPin className="w-2.5 h-2.5 text-theme-primary shrink-0" />
            )}
            <span className="max-w-[85px] sm:max-w-[125px] truncate">
              {activeHub?.name || 'Churachandpur'}
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 group-hover/hub:text-theme-primary transition-colors shrink-0" />
          </button>
        ) : variant === 'drawer' ? (
          <button
            type="button"
            onClick={handleOpen}
            data-testid="hub-switcher-drawer-display"
            className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-between gap-2 text-xs font-semibold text-[var(--ps-text)] hover:border-theme-primary/50 transition-colors cursor-pointer outline-none"
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
              <span className="truncate">{activeHub?.name || 'Churachandpur'} Hub</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
              {isSwitchingHub && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>Switch</span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleOpen}
            data-testid="hub-switcher-header-pill"
            className="h-8 px-2 sm:px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1 sm:gap-1.5 text-xs font-semibold text-[var(--ps-text)] transition-colors cursor-pointer outline-none"
          >
            {isSwitchingHub ? (
              <Loader2 className="w-3.5 h-3.5 text-theme-primary animate-spin shrink-0" />
            ) : (
              <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
            )}
            <span className="max-w-[78px] sm:max-w-[130px] truncate">
              {activeHub?.name || 'Churachandpur'}
            </span>
            <ChevronDown className="w-3 h-3 text-[var(--ps-text-muted)] shrink-0" />
          </button>
        )}
      </div>

      <UnifiedHubModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          onActionComplete?.();
        }}
        initialView="list"
      />
    </>
  );
}

export default HubSwitcherPill;
