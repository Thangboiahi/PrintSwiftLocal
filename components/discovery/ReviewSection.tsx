'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CornerDownRight,
  Loader2,
  MessageSquareQuote,
  Send,
  Star,
  User,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { ReviewListSkeleton } from '@/components/shared/Skeletons';
import { getDeterministicMegaSeedDataset } from '@/scripts/seed';

export interface SupabaseReviewRow {
  id: string;
  listing_id: string;
  reviewer_name?: string | null;
  author_name?: string | null;
  rating: number;
  comment?: string | null;
  owner_reply?: string | null;
  created_at?: string | null;
}

export interface ReviewSectionProps {
  listingId: string;
  listingTitle?: string;
}

export function ReviewSection({ listingId, listingTitle }: ReviewSectionProps) {
  const [reviews, setReviews] = useState<SupabaseReviewRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // "Write a Review" form state
  const [reviewerName, setReviewerName] = useState('');
  const [rating, setRating] = useState<number>(5);
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const loadReviews = useCallback(async () => {
    if (!listingId) {
      setIsLoading(false);
      return;
    }

    const fallbackSeedItem = getDeterministicMegaSeedDataset().find(
      (item) => item.id === listingId
    );
    const seedFallbackReviews: SupabaseReviewRow[] = fallbackSeedItem
      ? fallbackSeedItem.reviews.map((rev, idx) => ({
          id: `${listingId}-rev-${idx + 1}`,
          listing_id: listingId,
          reviewer_name: rev.reviewer_name,
          author_name: rev.reviewer_name,
          rating: rev.rating,
          comment: rev.comment,
          owner_reply: rev.owner_reply,
          created_at: new Date(
            Date.now() - (idx + 1) * 86400000 * 3
          ).toISOString(),
        }))
      : [];

    if (!isSupabaseConfigured()) {
      setReviews(seedFallbackReviews);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const dbReviews = Array.isArray(data) ? (data as SupabaseReviewRow[]) : [];
      setReviews(dbReviews.length > 0 ? dbReviews : seedFallbackReviews);
      setFetchError(null);
    } catch (err) {
      if (seedFallbackReviews.length > 0) {
        setReviews(seedFallbackReviews);
        setFetchError(null);
      } else {
        setFetchError(
          err instanceof Error ? err.message : 'Unable to load reviews.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    let active = true;
    async function initReviews() {
      await Promise.resolve();
      if (!active) return;
      await loadReviews();
    }
    void initReviews();
    return () => {
      active = false;
    };
  }, [loadReviews]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    const total = reviews.reduce(
      (sum, r) => sum + (Number(r.rating) || 0),
      0
    );
    return Number((total / reviews.length).toFixed(1));
  }, [reviews]);

  const handleSubmitReview = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    const trimmedName = reviewerName.trim();
    const trimmedComment = comment.trim();

    if (!trimmedName || !trimmedComment) {
      setSubmitError('Please enter your name and write a brief review comment.');
      return;
    }

    if (rating < 1 || rating > 5) {
      setSubmitError('Please select a star rating between 1 and 5.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error(
          'Supabase backend is not configured. Please check your environment variables.'
        );
      }

      const { data, error } = await supabase
        .from('reviews')
        .insert({
          listing_id: listingId,
          reviewer_name: trimmedName,
          rating,
          comment: trimmedComment,
        })
        .select('*')
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      if (data) {
        setReviews((prev) => [data as SupabaseReviewRow, ...prev]);
      } else {
        await loadReviews();
      }

      setReviewerName('');
      setRating(5);
      setComment('');
      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Unable to submit your review right now. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      data-testid="listing-review-section"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-xs space-y-6"
    >
      {/* Header & Average Rating Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ps-border)] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Community Reviews &amp; Ratings
            </h2>
          </div>
          {listingTitle && (
            <p className="text-xs text-[var(--ps-text-muted)]">
              Public feedback and owner responses for {listingTitle}
            </p>
          )}
        </div>

        {/* Average Rating Badge */}
        <div
          data-testid="review-average-summary"
          className="flex items-center gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5"
        >
          <div className="flex items-center gap-1 text-amber-500">
            <Star className="h-5 w-5 fill-amber-400 text-amber-500" />
            <span className="text-lg font-extrabold text-[var(--ps-text)]">
              {reviews.length > 0 ? averageRating.toFixed(1) : '—'}
            </span>
          </div>
          <div className="text-xs text-[var(--ps-text-muted)] border-l border-[var(--ps-border)] pl-3">
            <div className="font-bold text-[var(--ps-text)]">
              {reviews.length} {reviews.length === 1 ? 'Review' : 'Reviews'}
            </div>
            <div className="text-[11px]">Verified Community Rating</div>
          </div>
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {isLoading ? (
          <ReviewListSkeleton count={2} />
        ) : fetchError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{fetchError}</span>
          </div>
        ) : reviews.length === 0 ? (
          <div
            data-testid="reviews-empty-state"
            className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]"
          >
            No reviews yet for this listing. Be the first to share your
            experience below!
          </div>
        ) : (
          <div className="space-y-3" data-testid="reviews-list">
            {reviews.map((rev) => {
              const displayName =
                rev.reviewer_name || rev.author_name || 'Community Visitor';
              const starCount = Math.min(5, Math.max(1, Number(rev.rating) || 5));
              const formattedDate = rev.created_at
                ? new Date(rev.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })
                : 'Recently';

              return (
                <article
                  key={rev.id}
                  data-testid={`review-card-${rev.id}`}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] font-bold">
                        <User className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <span className="font-bold text-[var(--ps-text)] block">
                          {displayName}
                        </span>
                        <span className="text-[11px] text-[var(--ps-text-muted)]">
                          {formattedDate}
                        </span>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-0.5"
                      aria-label={`Rated ${starCount} out of 5 stars`}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`h-3.5 w-3.5 ${
                            n <= starCount
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-slate-300 dark:text-slate-700'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {rev.comment && (
                    <p className="text-xs leading-relaxed text-[var(--ps-text)]">
                      {rev.comment}
                    </p>
                  )}

                  {/* Owner Reply Block */}
                  {rev.owner_reply && (
                    <div
                      data-testid={`owner-reply-${rev.id}`}
                      className="mt-2 rounded-xl border border-[var(--ps-accent)]/30 bg-[var(--ps-surface)] p-3.5 pl-4 space-y-1"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ps-accent)]">
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
                        <span>Listing Owner Response</span>
                      </div>
                      <p className="text-xs leading-relaxed text-[var(--ps-text)]">
                        {rev.owner_reply}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Write a Review Form */}
      <div className="border-t border-[var(--ps-border)] pt-5">
        <h3 className="text-sm font-bold text-[var(--ps-text)] mb-3">
          Write a Review
        </h3>

        <form
          onSubmit={handleSubmitReview}
          className="space-y-4 text-xs"
          noValidate
        >
          {submitError && (
            <div
              role="alert"
              data-testid="review-submit-error"
              className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-medium text-rose-700 dark:text-rose-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {submitSuccess && (
            <div
              role="status"
              data-testid="review-submit-success"
              className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Thank you! Your review has been published.</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Reviewer Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="review-reviewer-name"
                className="block font-bold text-[var(--ps-text)]"
              >
                Your Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="review-reviewer-name"
                type="text"
                required
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="e.g., Lunminlal Kipgen"
                disabled={isSubmitting}
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
              />
            </div>

            {/* Interactive 1-5 Star Selector */}
            <div className="space-y-1.5">
              <span className="block font-bold text-[var(--ps-text)]">
                Star Rating (1–5) <span className="text-rose-500">*</span>
              </span>
              <div
                role="radiogroup"
                aria-label="Select a star rating from 1 to 5"
                className="flex items-center gap-1.5 pt-1"
              >
                {[1, 2, 3, 4, 5].map((starValue) => {
                  const activeValue = hoveredStar ?? rating;
                  const isFilled = starValue <= activeValue;
                  return (
                    <button
                      key={starValue}
                      type="button"
                      role="radio"
                      aria-checked={rating === starValue}
                      aria-label={`Rate ${starValue} star${starValue > 1 ? 's' : ''}`}
                      data-testid={`review-star-btn-${starValue}`}
                      onClick={() => setRating(starValue)}
                      onMouseEnter={() => setHoveredStar(starValue)}
                      onMouseLeave={() => setHoveredStar(null)}
                      disabled={isSubmitting}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] transition hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                    >
                      <Star
                        className={`h-4 w-4 transition-colors ${
                          isFilled
                            ? 'fill-amber-400 text-amber-500'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </button>
                  );
                })}
                <span className="ml-2 text-xs font-bold text-[var(--ps-text)]">
                  {rating} / 5
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="review-comment"
              className="block font-bold text-[var(--ps-text)]"
            >
              Your Review <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="review-comment"
              rows={3}
              required
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share details about your visit, service quality, or responsiveness..."
              disabled={isSubmitting}
              className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
            />
          </div>

          <div className="flex items-center justify-end pt-1">
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="review-submit-btn"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 py-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Submitting Review...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Submit Review</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default ReviewSection;
