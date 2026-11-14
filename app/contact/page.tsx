'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
} from 'lucide-react';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('Listing Verification & Support');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSubmitted(true);
  };

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
          </div>
        </div>

        {/* Header */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 shadow-xs space-y-3">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--ps-surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--ps-accent)]">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>District Support & Onboarding Desk</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
            Contact PrintSwift Local — Churachandpur
          </h1>
          <p className="text-sm text-[var(--ps-text-muted)]">
            Reach our Lamka support desk for listing verification, 360° property panorama assistance, business catalogue onboarding, or general district inquiries.
          </p>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* District Support Channels & Office Reference */}
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ps-text)]">
                District Support Channels
              </h2>

              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 shrink-0 text-[var(--ps-accent)] mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Office Reference
                  </div>
                  <p className="text-[var(--ps-text-muted)]">
                    Tedim Road, Near Dorcas Hall, New Lamka, Churachandpur — 795128, Manipur
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Phone className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Support Helpline & WhatsApp
                  </div>
                  <p className="font-mono text-[var(--ps-text-muted)]">
                    +91 98620 11220
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail className="h-4 w-4 shrink-0 text-sky-500 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Verification & Helpdesk Email
                  </div>
                  <p className="font-mono text-[var(--ps-text-muted)]">
                    support@printswiftlocal.in
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[var(--ps-text)]">
                    Operating Hours
                  </div>
                  <p className="text-[var(--ps-text-muted)]">
                    Mon – Sat: 09:00 AM – 06:00 PM IST
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
                  Thank you, {name}. Our Churachandpur support team will respond to {email} shortly.
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
                      className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
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
                      className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contact-topic"
                    className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
                  >
                    Inquiry Topic
                  </label>
                  <select
                    id="contact-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  >
                    <option value="Listing Verification & Support">
                      Listing Verification & Support
                    </option>
                    <option value="360° Real-Estate Panorama Capture">
                      360° Real-Estate Panorama Capture
                    </option>
                    <option value="Business Catalogue Onboarding">
                      Business Catalogue Onboarding
                    </option>
                    <option value="Report Map Coordinate or Boundary Issue">
                      Report Map Coordinate or Boundary Issue
                    </option>
                  </select>
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
                    placeholder="Share your listing ID, locality, or question..."
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Submit Inquiry</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
