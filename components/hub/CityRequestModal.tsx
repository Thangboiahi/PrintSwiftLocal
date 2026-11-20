'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, MapPin, Send, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';

export interface CityRequestModalProps {
  open: boolean;
  onClose: () => void;
  initialCity?: string;
  initialState?: string;
  initialNote?: string;
  lat?: number;
  lng?: number;
  onSuccess?: (city: string) => void;
}

export function CityRequestModal({
  open,
  onClose,
  initialCity = '',
  initialState = '',
  initialNote,
  lat,
  lng,
  onSuccess,
}: CityRequestModalProps) {
  const { session } = useAuth();
  const { setStatus } = useAppStatus();

  const [city, setCity] = useState(initialCity);
  const [state, setState] = useState(initialState);
  const [contactInfo, setContactInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Sync state whenever opened with new initial data
  React.useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setCity(initialCity);
        setState(initialState);
        setContactInfo('');
        setFeedback(null);
      });
    }
  }, [open, initialCity, initialState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cityClean = city.trim();
    if (cityClean.length < 2) {
      setFeedback({
        type: 'error',
        text: 'Please enter a valid city or town name.',
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    setStatus('saving', 'Submitting hub expansion request');

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/hubs/request-city', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requested_city: cityClean,
          state: state.trim() || null,
          contact_info: contactInfo.trim() || null,
          lat: lat ?? null,
          lng: lng ?? null,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: payload.error || 'Could not submit request.',
        });
        setStatus('error', 'Request failed');
        return;
      }

      setStatus('success', 'Hub expansion requested');
      setFeedback({
        type: 'success',
        text: `Request logged for ${cityClean}! We will prioritize expansion based on local demand.`,
      });
      onSuccess?.(cityClean);
      window.setTimeout(() => {
        onClose();
      }, 1100);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Network error while submitting request.',
      });
      setStatus('error', 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl overflow-hidden p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-theme-primary/10 text-theme-primary flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Request a New Hub
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Bring PrintSwift Local to your town
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text-muted)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {initialNote && (
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-2.5 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              {initialNote}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                City / Town Name *
              </label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Imphal, Moreh, Kohima, Shillong"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                State / Region (Optional)
              </label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. Manipur, Mizoram, Nagaland"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                WhatsApp or Email (Optional)
              </label>
              <input
                type="text"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="Get notified when this hub launches"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
              />
            </div>

            {feedback && (
              <div
                className={`rounded-xl p-2.5 text-xs font-semibold ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded-xl text-xs font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || city.trim().length < 2}
                className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs hover:opacity-95 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Submit Request</span>
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
