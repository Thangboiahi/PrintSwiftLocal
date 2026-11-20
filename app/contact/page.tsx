'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
} from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';

function buildWhatsAppUrl(phoneRaw: string, appName: string): string | null {
  const digits = phoneRaw.replace(/\D/g, '');
  if (!digits) return null;
  const fullNumber = digits.length === 10 ? `91${digits}` : digits;
  const text = encodeURIComponent(
    `Hello ${appName} Support Desk, I have a question regarding the platform.`
  );
  return `https://wa.me/${fullNumber}?text=${text}`;
}

export default function ContactPage() {
  const { identity, office } = useAppConfig();
  const appName = identity.app_name?.trim() || 'PrintSwift Local';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('Listing Verification & Support');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const displayPhone = office.phone?.trim() || 'Available via Support Form';
  const displayEmail = office.email?.trim() || 'support@printswiftlocal.in';
  const whatsappUrl = buildWhatsAppUrl(
    office.whatsapp?.trim() || office.phone?.trim() || '',
    appName
  );
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${office.lat},${office.lng}`
  )}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSubmitted(true);
  };

  return (
    <div className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6 sm:space-y-8">
        {/* Top Back Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Back to {identity.short_name || 'Home'}</span>
          </Link>
          <div className="flex items-center gap-3 text-xs font-semibold">
            <Link
              href="/about"
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              About Us
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/contact"
              aria-current="page"
              className="text-[var(--ps-accent)]"
            >
              Contact
            </Link>
            <span className="text-[var(--ps-border)]">•</span>
            <Link
              href="/legal/refund-policy"
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              Refund Policy
            </Link>
          </div>
        </div>

        {/* Header */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 shadow-xs space-y-3">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>District Support &amp; Onboarding Desk</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
            Contact {appName}
          </h1>
          <p className="text-sm text-[var(--ps-text-muted)]">
            Reach our Lamka support desk for listing verification, Pick N Drop
            assistance, vehicle bookings, payment queries, or business catalogue
            onboarding.
          </p>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* District Support Channels & Office Reference (Live from AppConfigProvider) */}
          <div className="space-y-4 lg:col-span-2">
            <div
              data-testid="contact-office-card"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4"
            >
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ps-text)]">
                District Support Channels
              </h2>

              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 shrink-0 text-[var(--ps-accent)] mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-[var(--ps-text)]">
                    District Office
                  </div>
                  <p className="text-[var(--ps-text-muted)]">
                    {office.address}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                      {office.lat.toFixed(4)}° N, {office.lng.toFixed(4)}° E
                    </span>
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ps-accent)] hover:underline"
                    >
                      <span>Directions</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Phone className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Support Helpline &amp; WhatsApp
                  </div>
                  {office.phone?.trim() ? (
                    <a
                      href={`tel:${office.phone.replace(/\s+/g, '')}`}
                      className="font-mono text-[var(--ps-accent)] hover:underline block"
                    >
                      {displayPhone}
                    </a>
                  ) : (
                    <p className="text-[var(--ps-text-muted)]">
                      {displayPhone}
                    </p>
                  )}
                  {whatsappUrl && (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 mt-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Chat on WhatsApp</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 shrink-0 text-sky-500 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Verification &amp; Helpdesk Email
                  </div>
                  <a
                    href={`mailto:${displayEmail}`}
                    className="font-mono text-[var(--ps-accent)] hover:underline break-all"
                  >
                    {displayEmail}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Operating Hours
                  </div>
                  <p className="text-[var(--ps-text-muted)]">
                    {office.operating_hours}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Inquiry Form */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 lg:col-span-3">
            <h2 className="text-base font-bold text-[var(--ps-text)] mb-4">
              Send a District Support Inquiry
            </h2>

            {submitted ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center space-y-2"
              >
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Inquiry Received
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Thank you, {name}. Our {appName} support team will respond to{' '}
                  {email} shortly.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setName('');
                    setEmail('');
                    setMessage('');
                  }}
                  className="mt-2 inline-flex items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text)]"
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
                    >
                      Your Name
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Zorinpuia Sailo"
                      className="w-full h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
                    >
                      Email Address
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                <div>
                  <CustomSelectModal
                    id="contact-topic"
                    testId="contact-topic-select"
                    label="Inquiry Topic"
                    value={topic}
                    onChange={(val) => setTopic(val)}
                    options={[
                      {
                        value: 'Listing Verification & Support',
                        label: 'Listing Verification & Support',
                      },
                      {
                        value: 'Payments, UPI & Refunds',
                        label: 'Payments, UPI & Refunds',
                      },
                      {
                        value: 'Pick N Drop & Vehicle Bookings',
                        label: 'Pick N Drop & Vehicle Bookings',
                      },
                      {
                        value: '360° Real-Estate Panorama Capture',
                        label: '360° Real-Estate Panorama Capture',
                      },
                      {
                        value: 'Business Catalogue Onboarding',
                        label: 'Business Catalogue Onboarding',
                      },
                      {
                        value: 'Report Map Coordinate or Boundary Issue',
                        label: 'Report Map Coordinate or Boundary Issue',
                      },
                    ]}
                  />
                </div>

                <div>
                  <label
                    htmlFor="contact-message"
                    className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
                  >
                    Message
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Share your listing ID, payment ref code, locality, or question..."
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Submit Inquiry</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
