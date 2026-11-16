'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
  onUnmountOverlay?: () => void;
}

export function triggerUnmountOverlaysToMap() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('printswift:unmount-overlays'));
  }
}

export function Breadcrumbs({
  items,
  className = '',
  onUnmountOverlay,
}: BreadcrumbsProps) {
  const router = useRouter();

  const handleReturnToMap = (
    e: React.MouseEvent<HTMLAnchorElement>,
    targetHref = '/'
  ) => {
    e.preventDefault();
    triggerUnmountOverlaysToMap();
    if (onUnmountOverlay) {
      onUnmountOverlay();
    }
    router.push(targetHref);
  };

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumb-navigation"
      className={`flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--ps-text-muted)] ${className}`}
    >
      <Link
        href="/"
        data-testid="breadcrumb-home-link"
        onClick={(e) => handleReturnToMap(e, '/')}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--ps-text-muted)] transition-colors hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
      >
        <Home className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
        <span>Home</span>
      </Link>

      {items?.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const isMapTarget =
          item.href === '/' || Boolean(item.href && item.href.startsWith('/?'));

        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-[var(--ps-border)]"
              aria-hidden="true"
            />
            {item.href && !isLast ? (
              <Link
                href={item.href}
                onClick={(e) => {
                  if (item.onClick) {
                    item.onClick();
                  }
                  if (isMapTarget) {
                    handleReturnToMap(e, item.href!);
                  }
                }}
                className="rounded-lg px-2 py-1 text-[var(--ps-text-muted)] transition-colors hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={`px-2 py-1 truncate max-w-[260px] sm:max-w-[380px] ${
                  isLast
                    ? 'font-bold text-[var(--ps-text)]'
                    : 'text-[var(--ps-text-muted)]'
                }`}
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export default Breadcrumbs;
