'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';

export interface EnquiryFormProps {
  listingId: string;
  listingTitle?: string;
}

export function triggerOpenOwnerMessagingCenter() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('printswift:open-messages'));
  }
}

export function EnquiryForm({ listingId, listingTitle }: EnquiryFormProps) {
  const [senderName, setSenderName] = useState('');
  const [senderContact, setSenderContact] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const { confirm: confirmEnquiry, dialog: confirmEnquiryDialog } =
    useConfirmDialog();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = senderName.trim();
    const trimmedContact = senderContact.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedContact || !trimmedMessage) {
      setErrorMessage(
        'Please complete your name, phone or email contact, and enquiry message.'
      );
      return;
    }

    const ok = await confirmEnquiry({
      title: `Send enquiry to ${listingTitle || 'this listing'}?`,
      description: `Your name (${trimmedName}), contact (${trimmedContact}), and message will be shared with the business owner.`,
      confirmLabel: 'Confirm & Send',
      cancelLabel: 'Review',
      variant: 'default',
    });
    if (!ok) return;

    setIsSubmitting(true);

    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.from('enquiries').insert({
          listing_id: listingId,
          sender_name: trimmedName,
          sender_contact: trimmedContact,
          message: trimmedMessage,
          status: 'new',
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      setIsSubmitted(true);
      setShowSuccessToast(true);
      setSenderName('');
      setSenderContact('');
      setMessage('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to send your enquiry right now. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      data-testid="listing-enquiry-form-section"
      className="relative rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-4"
    >
      {/* Phase 20: Floating Success Toast with "View Messages" Deep Link */}
      {showSuccessToast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="enquiry-success-toast"
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-[70] max-w-sm w-[calc(100vw-2rem)] rounded-2xl border border-emerald-500/40 bg-slate-950/95 text-white p-4 shadow-2xl backdrop-blur-md space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Enquiry Delivered to Owner</span>
            </div>
            <button
              type="button"
              onClick={() => setShowSuccessToast(false)}
              aria-label="Dismiss notification"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Your message regarding{' '}
            <strong className="text-white">
              {listingTitle || 'this listing'}
            </strong>{' '}
            was recorded in the messaging center.
          </p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Link
              href="/messages"
              data-testid="toast-view-messages-link"
              onClick={() => {
                triggerOpenOwnerMessagingCenter();
                setShowSuccessToast(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
            >
              <span>View Messages</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setShowSuccessToast(false)}
              className="text-[11px] font-semibold text-slate-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-[var(--ps-accent)]" />
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Send an Enquiry to the Listing Owner
          </h2>
        </div>
        {listingTitle && (
          <span className="text-xs font-medium text-[var(--ps-text-muted)] truncate max-w-xs">
            Re: {listingTitle}
          </span>
        )}
      </div>

      {isSubmitted ? (
        <div
          role="status"
          data-testid="enquiry-success-banner"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-xs space-y-3"
        >
          <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Enquiry Sent Successfully</span>
          </div>
          <p className="text-[var(--ps-text-muted)] leading-relaxed">
            Your message has been delivered to the listing owner. They will
            reach out to you via the contact details you provided.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Link
              href="/messages"
              data-testid="enquiry-view-messages-link"
              onClick={() => triggerOpenOwnerMessagingCenter()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>View Messages</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => setIsSubmitted(false)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
            >
              <span>Send Another Message</span>
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs" noValidate>
          {errorMessage && (
            <div
              role="alert"
              data-testid="enquiry-error-banner"
              className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-medium text-rose-700 dark:text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="enquiry-sender-name"
                className="block font-bold text-[var(--ps-text)]"
              >
                Your Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="enquiry-sender-name"
                type="text"
                required
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="e.g., Thangboi Haokip"
                disabled={isSubmitting}
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <PhoneInputWithCountry
                id="enquiry-sender-contact"
                label="Phone / WhatsApp Number"
                required
                value={senderContact}
                onChange={(next) => setSenderContact(next)}
                disabled={isSubmitting}
                testId="enquiry-phone-input"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="enquiry-message"
              className="block font-bold text-[var(--ps-text)]"
            >
              Message <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="enquiry-message"
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your question about availability, pricing, or inspection timings..."
              disabled={isSubmitting}
              className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
            />
          </div>

          <div className="flex items-center justify-end pt-1">
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="enquiry-submit-btn"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending Enquiry...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Send Enquiry</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
      {confirmEnquiryDialog}
    </section>
  );
}

export default EnquiryForm;
