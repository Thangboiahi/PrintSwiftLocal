import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Compass,
  Globe,
  MapPin,
  ShieldCheck,
} from 'lucide-react';

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Top Back Navigation */}
        <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to Discovery Map</span>
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
          </div>
        </div>

        {/* Hero Section */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 shadow-xs space-y-4">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
            <Compass className="h-3.5 w-3.5" />
            <span>PrintSwift Local — Churachandpur (Lamka)</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
            Map-First Local Discovery & Verified Directory for Churachandpur District
          </h1>
          <p className="text-sm sm:text-base leading-relaxed text-[var(--ps-text-muted)]">
            PrintSwift Local connects residents, visitors, property seekers, and local enterprises across Lamka and Churachandpur District through an interactive geospatial directory. Built with strict spatial accuracy and media verification standards, the platform unifies local businesses, real estate, services, sports facilities, and community landmarks.
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
              Tailored for Churachandpur localities including New Lamka, Tuibong, Rengkai, Zenhang Lamka, Hiangtam Lamka, and Pearsonmun.
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
              Every published real-estate listing enforces verified 2:1 equirectangular 360° panoramas and canonical square-metre (m²) area reporting.
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
              Dedicated workspaces for Listing Owners, Delegated Staff, and a 7-role Administrative Verification & Moderation Centre.
            </p>
          </div>
        </section>

        {/* Data Integrity Standards */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[var(--ps-accent)]" />
            <h2 className="text-lg font-bold text-[var(--ps-text)]">
              Data Integrity & Non-Cadastral Boundary Standards
            </h2>
          </div>
          <ul className="space-y-2.5 text-xs sm:text-sm text-[var(--ps-text-muted)]">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Canonical Metric Area Units:</strong> All land and built-up measurements are stored canonically in square metres (m²) with instant unit conversion to sq ft, acres, and hectares.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Indicative Boundary Polygons:</strong> On-map property polygons serve visual discovery and spatial estimation purposes and do not replace official government cadastral surveys.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                <strong>Verification & Audit Trail:</strong> Every publication status transition, verification review, and coordinate update is recorded in the platform audit log.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
