'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Clock, Layers } from 'lucide-react';

export interface ComingSoonBuilderCardProps {
  title: string;
  milestone: string;
  description: string;
  readyFoundation: string[];
  icon?: LucideIcon;
  compact?: boolean;
}

export function ComingSoonBuilderCard({
  title,
  milestone,
  description,
  readyFoundation,
  icon: Icon = Layers,
  compact = false,
}: ComingSoonBuilderCardProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-accent)]">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                {title}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                <Clock className="h-3 w-3" />
                Coming in {milestone}
              </span>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed max-w-2xl">
              {description}
            </p>
          </div>
        </div>
      </div>

      {readyFoundation.length > 0 && (
        <div className="mt-4 border-t border-[var(--ps-border)] pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
            Provisioned in v15a Foundation
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {readyFoundation.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-xs text-[var(--ps-text)]"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default ComingSoonBuilderCard;
