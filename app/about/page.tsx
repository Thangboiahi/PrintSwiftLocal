'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';

export default function AboutPage() {
  const { identity, office, localities } = useAppConfig();
  const appName = identity.app_name?.trim() || 'DD oodle';
  const tagline = identity.tagline?.trim() || 'Your Daily Discovery';

  const localityPreview =
    localities.length > 0
      ? localities
          .slice(0, 6)
          .map((loc) => loc.display_name)
          .join(', ')
      : 'New Lamka, Tuibong, Rengkai, Zenhang Lamka, Hiangtam Lamka, and Pearsonmun';

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${office.lat},${office.lng}`
  )}`;

  return (
    <div className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
        {/* Top Back Navigation */}
        <div className="sticky top-[60px] md:top-[64px] z-20 -mx-2 px-2 py-2.5 bg-white/85 dark:bg-slate-950/85 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to {identity.short_name || 'DD oodle'}</span>
          </Link>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link
              href="/about"
              aria-current="page"
              className="text-[var(--ps-accent)]"
            >
              About Us
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/contact"
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              Contact
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/legal/terms"
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              Terms
            </Link>
          </div>
        </div>

        {/* Hero Section */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 shadow-xs space-y-4">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
            <Compass className="h-3.5 w-3.5" />
            <span>{appName} — Churachandpur (Lamka)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
            {tagline}
          </h1>
          <p className="text-sm sm:text-base leading-relaxed text-[var(--ps-text-muted)]">
            {appName} connects residents, visitors, property seekers, drivers,
            and local enterprises across Lamka and Churachandpur District
            through an interactive geospatial directory, marketplace, Pick N
            Drop courier desk, vehicle bookings, and verified community
            bulletin.
          </p>
        </section>

        {/* Mission & District Focus */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
              <MapPin className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Hyper-Local Precision
            </h2>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Tailored for Churachandpur localities including {localityPreview}.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ps-surface-alt)] text-emerald-500">
              <Globe className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Mandatory 360° Property Media
            </h2>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Every published real-estate listing enforces verified 2:1
              equirectangular 360° panoramas and canonical square-metre (m²)
              area reporting.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ps-surface-alt)] text-sky-500">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Multi-Role Governance
            </h2>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Dedicated workspaces for Listing Owners, Drivers, Delegated Staff,
              and a 7-role Administrative Verification &amp; Moderation Centre.
            </p>
          </div>
        </section>

        {/* Live District Office Card (from platform_settings.office_and_contact) */}
        <section
          data-testid="about-district-office-card"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[var(--ps-accent)]" />
              <h2 className="text-lg font-bold text-[var(--ps-text)]">
                District Office &amp; Support Desk
              </h2>
            </div>
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-accent)] inline-flex items-center gap-1.5 hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <span>Open in Google Maps</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-[var(--ps-text-muted)]">
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-[var(--ps-accent)] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-[var(--ps-text)]">Address</div>
                <p>{office.address}</p>
                <p className="font-mono text-[11px] opacity-80">
                  {office.lat.toFixed(4)}° N, {office.lng.toFixed(4)}° E
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-[var(--ps-text)]">
                  Operating Hours
                </div>
                <p>{office.operating_hours}</p>
              </div>
            </div>

            {office.phone && (
              <div className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-[var(--ps-text)]">
                    Support Helpline
                  </div>
                  <a
                    href={`tel:${office.phone.replace(/\s+/g, '')}`}
                    className="font-mono text-[var(--ps-accent)] hover:underline"
                  >
                    {office.phone}
                  </a>
                </div>
              </div>
            )}

            {office.email && (
              <div className="flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-[var(--ps-text)]">Email</div>
                  <a
                    href={`mailto:${office.email}`}
                    className="font-mono text-[var(--ps-accent)] hover:underline"
                  >
                    {office.email}
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Data Integrity Standards */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--ps-accent)]" />
            <h2 className="text-lg font-bold text-[var(--ps-text)]">
              Data Integrity &amp; Policy Standards
            </h2>
          </div>
          <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--ps-text-muted)]">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Canonical Metric Area Units:</strong> All land and
                built-up measurements are stored canonically in square metres
                (m²) with instant unit conversion to sq ft, acres, and hectares.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Indicative Boundary Polygons:</strong> On-map property
                polygons serve visual discovery and spatial estimation purposes
                and do not replace official government cadastral surveys.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Transparent Policies:</strong> Review our{' '}
                <Link
                  href="/legal/terms"
                  className="font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  Terms &amp; Conditions
                </Link>
                ,{' '}
                <Link
                  href="/legal/privacy"
                  className="font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  Privacy Policy
                </Link>
                , and{' '}
                <Link
                  href="/legal/refund-policy"
                  className="font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  Refund &amp; Cancellation Policy
                </Link>{' '}
                at any time.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
