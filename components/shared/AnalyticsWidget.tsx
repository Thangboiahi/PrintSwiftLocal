'use client';

import React from 'react';
import { MapPin, Eye, MessageCircle, TrendingUp } from 'lucide-react';

export interface AnalyticsMetric {
  id: string;
  label: string;
  value: number | string;
  changeLabel?: string;
  subtitle?: string;
}

export interface AnalyticsWidgetProps {
  mapImpressions?: number;
  detailVisits?: number;
  whatsappClicks?: number;
  metrics?: AnalyticsMetric[];
  className?: string;
}

export function AnalyticsWidget({
  mapImpressions = 1420,
  detailVisits = 384,
  whatsappClicks = 96,
  metrics,
  className = '',
}: AnalyticsWidgetProps) {
  const defaultMetrics: AnalyticsMetric[] = [
    {
      id: 'map-impressions',
      label: 'Map Impressions',
      value: mapImpressions.toLocaleString(),
      changeLabel: '+14.2% (30d)',
      subtitle: 'Viewport & pin appearances across local discovery',
    },
    {
      id: 'detail-visits',
      label: 'Detail Visits',
      value: detailVisits.toLocaleString(),
      changeLabel: '+8.6% (30d)',
      subtitle: 'Direct listing drawer & profile inspections',
    },
    {
      id: 'whatsapp-clicks',
      label: 'WhatsApp Clicks',
      value: whatsappClicks.toLocaleString(),
      changeLabel: '+19.4% (30d)',
      subtitle: 'Direct outbound buyer & customer messages',
    },
  ];

  const items = metrics && metrics.length > 0 ? metrics : defaultMetrics;

  const getIcon = (id: string) => {
    switch (id) {
      case 'map-impressions':
        return <MapPin className="w-4 h-4 text-[var(--ps-accent)]" />;
      case 'detail-visits':
        return <Eye className="w-4 h-4 text-sky-400" />;
      case 'whatsapp-clicks':
        return <MessageCircle className="w-4 h-4 text-emerald-400" />;
      default:
        return <TrendingUp className="w-4 h-4 text-[var(--ps-accent)]" />;
    }
  };

  return (
    <section
      aria-label="Owner Performance Analytics"
      className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${className}`}
    >
      {items.map((metric) => (
        <div
          key={metric.id}
          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between transition-colors hover:border-[var(--ps-accent)]/40"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
              {metric.label}
            </span>
            <span className="p-1.5 rounded-lg bg-[var(--ps-surface-elevated)] border border-[var(--ps-border)]">
              {getIcon(metric.id)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2 my-1">
            <span className="text-2xl font-bold tracking-tight text-[var(--ps-text)] font-mono">
              {metric.value}
            </span>
            {metric.changeLabel && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <TrendingUp className="w-2.5 h-2.5" />
                {metric.changeLabel}
              </span>
            )}
          </div>

          {metric.subtitle && (
            <p className="text-[11px] text-[var(--ps-text-muted)] mt-1.5 line-clamp-1">
              {metric.subtitle}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
