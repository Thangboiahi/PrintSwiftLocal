'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ImagePlus,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { FormModal } from '@/components/ui/FormModal';
import {
  compressPodImageToWebp,
  type CompressedPodResult,
} from '@/lib/media/pod-compressor';
import type { HandoverTarget } from '@/lib/driver/types';
import { supabase } from '@/lib/supabase/client';

export interface DriverOtpPodModalProps {
  target: HandoverTarget | null;
  onClose: () => void;
  onVerified: (result: {
    bookingId: string;
    stage: string;
    nextStatus: string;
    code: string;
  }) => Promise<void> | void;
}

function stageLabel(stage: HandoverTarget['stage']): string {
  if (stage === 'pickup') return 'Pickup Handover';
  if (stage === 'dropoff') return 'Dropoff Handover';
  return 'Return Handover';
}

export function DriverOtpPodModal({
  target,
  onClose,
  onVerified,
}: DriverOtpPodModalProps) {
  const [otpInput, setOtpInput] = useState('');
  const [otpTouched, setOtpTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [compressedPod, setCompressedPod] =
    useState<CompressedPodResult | null>(null);
  const [podPreviewUrl, setPodPreviewUrl] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const targetKey = target ? `${target.bookingId}:${target.stage}` : '';

  // Cleanly reset local form state whenever target changes or modal closes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOtpInput('');
      setOtpTouched(false);
      setSubmitAttempted(false);
      setCompressedPod(null);
      setPodError(null);
      setUploadProgress(0);
      setServerError(null);
      setPodPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [targetKey]);

  // Ensure object URL is revoked on unmount
  useEffect(() => {
    return () => {
      if (podPreviewUrl) {
        URL.revokeObjectURL(podPreviewUrl);
      }
    };
  }, [podPreviewUrl]);

  const showPodSection = Boolean(
    target && (target.stage === 'dropoff' || target.stage === 'return')
  );
  const isPodMandatory = Boolean(
    target && target.stage === 'dropoff' && target.podRequired
  );

  const sanitizedOtp = otpInput.replace(/\D/g, '').slice(0, 6);

  const otpError = useMemo(() => {
    if (!sanitizedOtp) {
      return 'Enter the numeric handover OTP provided by the customer/recipient.';
    }
    if (sanitizedOtp.length < 4 || sanitizedOtp.length > 6) {
      return 'Handover OTP must be 4 to 6 digits.';
    }
    return null;
  }, [sanitizedOtp]);

  const podValidationError = useMemo(() => {
    if (isPodMandatory && !compressedPod) {
      return 'Capture or attach a Proof-of-Delivery photo before verifying Dropoff.';
    }
    return null;
  }, [isPodMandatory, compressedPod]);

  const validationSummary = useMemo(() => {
    const errs: string[] = [];
    if (otpError) errs.push(otpError);
    if (podValidationError) errs.push(podValidationError);
    return errs;
  }, [otpError, podValidationError]);

  const isDirty = Boolean(sanitizedOtp.length > 0 || compressedPod !== null);
  const isValid = validationSummary.length === 0 && !isCompressing;

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    // Reset input so re-selecting the same photo works
    event.target.value = '';
    if (!file) return;

    setPodError(null);
    setServerError(null);
    setIsCompressing(true);

    try {
      const result = await compressPodImageToWebp(file);
      const nextUrl = URL.createObjectURL(result.blob);
      setPodPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
      setCompressedPod(result);
    } catch (err) {
      setPodError(
        err instanceof Error
          ? err.message
          : 'Could not compress the selected photo. Please retake.'
      );
    } finally {
      setIsCompressing(false);
    }
  };

  const handleRemovePod = () => {
    setCompressedPod(null);
    setPodError(null);
    setUploadProgress(0);
    setPodPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const handleVerifiedSubmit = async () => {
    if (!target) return;
    setIsSubmitting(true);
    setServerError(null);
    setUploadProgress(0);

    try {
      let uploadedStoragePath: string | null = null;

      if (compressedPod) {
        setUploadProgress(25);
        const storagePath = `orders/${target.bookingId}/${compressedPod.fileName}`;
        const { error: uploadErr } = await supabase.storage
          .from('delivery-pods')
          .upload(storagePath, compressedPod.blob, {
            contentType: compressedPod.mimeType,
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadErr) {
          throw new Error(
            uploadErr.message ||
              'Failed to upload private Proof-of-Delivery photo.'
          );
        }

        uploadedStoragePath = storagePath;
        setUploadProgress(70);
      }

      const { data, error } = await supabase.rpc('driver_verify_handover_otp', {
        p_booking_id: target.bookingId,
        p_stage: target.stage,
        p_otp_input: sanitizedOtp,
        p_pod_storage_path: uploadedStoragePath,
      });

      if (error) {
        if (uploadedStoragePath) {
          await supabase.storage.from('delivery-pods').remove([uploadedStoragePath]).catch(() => {});
          uploadedStoragePath = null;
        }
        throw new Error(error.message || 'Handover verification failed.');
      }

      const payload = (data || {}) as {
        ok?: boolean;
        verified?: boolean;
        message?: string;
        status?: string;
        code?: string;
      };

      if (!payload.ok || !payload.verified) {
        if (uploadedStoragePath) {
          await supabase.storage.from('delivery-pods').remove([uploadedStoragePath]).catch(() => {});
          uploadedStoragePath = null;
        }
        setServerError(
          payload.message ||
            'Incorrect OTP. Ask the customer to re-check their booking code.'
        );
        setUploadProgress(0);
        return;
      }

      setUploadProgress(100);
      await onVerified({
        bookingId: target.bookingId,
        stage: target.stage,
        nextStatus: payload.status || 'in_transit',
        code: payload.code || target.code,
      });
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : 'Could not verify handover OTP right now.'
      );
      setUploadProgress(0);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(target)}
      title={target ? `${stageLabel(target.stage)} · ${target.code}` : 'Verify Handover OTP'}
      subtitle={
        target
          ? `${target.originLabel} → ${target.destinationLabel}`
          : undefined
      }
      hints={[
        'Ask the sender (Pickup) or recipient (Dropoff / Return) for their 4–6 digit handover OTP.',
        'OTP validation runs strictly server-side with automatic lockout protection after 5 wrong attempts.',
        ...(showPodSection
          ? [
              'Photos are automatically compressed to WebP (<= 250 KB) on your device for fast rural 4G uploads.',
            ]
          : []),
      ]}
      cautions={[
        'Never mark a handover complete without verifying the live code directly with the customer.',
        ...(isPodMandatory
          ? [
              'Dropoff Proof-of-Delivery photo is stored in a private bucket and automatically purged after 48 hours.',
            ]
          : []),
      ]}
      isDirty={isDirty}
      isValid={isValid}
      validationSummary={validationSummary}
      onSubmitAttempt={() => {
        setSubmitAttempted(true);
        setOtpTouched(true);
      }}
      submitLabel={
        target
          ? `Verify ${stageLabel(target.stage)}`
          : 'Verify Handover OTP'
      }
      confirmSubmitTitle={`Confirm ${target ? stageLabel(target.stage) : 'Handover'}`}
      confirmSubmitDescription="Submit this OTP (and private POD photo if attached) to advance the trip milestone."
      confirmSubmitCaution="Handover verification is logged to the immutable escrow audit trail."
      confirmSubmitImpact={[
        target ? `Trip: ${target.code}` : '',
        target ? `Stage: ${stageLabel(target.stage)}` : '',
        compressedPod
          ? `Private POD Photo: ${compressedPod.originalKb} KB → ${compressedPod.compressedKb} KB (${compressedPod.mimeType === 'image/webp' ? 'WebP' : 'JPEG'})`
          : isPodMandatory
            ? 'POD Required'
            : 'No POD photo attached',
      ].filter(Boolean)}
      isSubmitting={isSubmitting}
      maxWidthClassName="max-w-lg"
      onSubmit={handleVerifiedSubmit}
      onClose={onClose}
    >
      {/* Inline Server Error Banner */}
      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 leading-relaxed">{serverError}</div>
        </div>
      )}

      {/* Stage & Route Context Summary */}
      {target && (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              <KeyRound className="h-3.5 w-3.5" />
              {stageLabel(target.stage)}
            </span>
            <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
              {target.code}
            </span>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
            {target.originLabel} → {target.destinationLabel}
          </p>
        </div>
      )}

      {/* Numeric OTP Input */}
      <div className="space-y-1.5">
        <label
          htmlFor="driver-handover-otp"
          className="block text-xs font-bold text-[var(--ps-text)]"
        >
          Customer Handover OTP (4–6 Digits) *
        </label>
        <input
          id="driver-handover-otp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="Enter 6-digit OTP"
          value={sanitizedOtp}
          onChange={(e) => {
            setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
            setServerError(null);
          }}
          onBlur={() => setOtpTouched(true)}
          className="w-full min-h-[48px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-center font-mono text-xl font-bold tracking-[0.35em] text-[var(--ps-text)] placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
        />
        {(otpTouched || submitAttempted) && otpError && (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
            {otpError}
          </p>
        )}
      </div>

      {/* POD Capture & Client-Side WebP Compression */}
      {showPodSection && (
        <div className="space-y-2.5 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/70 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-[var(--ps-text)]">
                Proof-of-Delivery Photo {isPodMandatory ? '*' : '(Optional)'}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                Auto-compressed to lightweight WebP (&le; 250 KB) on your phone.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
              <Lock className="h-3 w-3 text-[var(--ps-accent)]" />
              Private
            </span>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />

          {!compressedPod ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={isCompressing || isSubmitting}
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 px-4 text-xs font-bold text-[var(--ps-accent)] transition-colors hover:bg-[var(--ps-accent)]/15 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="h-4 w-4 shrink-0" />
                <span>
                  {isCompressing ? 'Compressing Photo...' : 'Capture POD Photo'}
                </span>
              </button>
              <button
                type="button"
                disabled={isCompressing || isSubmitting}
                onClick={() => galleryInputRef.current?.click()}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                <ImagePlus className="h-4 w-4 shrink-0" />
                <span>Choose from Gallery</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {podPreviewUrl && (
                <div className="relative overflow-hidden rounded-xl border border-[var(--ps-border)] bg-black/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={podPreviewUrl}
                    alt="Compressed Proof-of-Delivery preview"
                    className="max-h-56 w-full object-contain bg-[var(--ps-surface)]"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="font-semibold">
                    {compressedPod.originalKb.toLocaleString('en-IN')} KB →{' '}
                    {compressedPod.compressedKb.toLocaleString('en-IN')} KB{' '}
                    {compressedPod.mimeType === 'image/webp' ? 'WebP' : 'JPEG'}
                  </span>
                  <span className="text-[11px] opacity-80">
                    ({compressedPod.width}×{compressedPod.height})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemovePod}
                  disabled={isSubmitting}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-emerald-600/30 bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Retake
                </button>
              </div>
            </div>
          )}

          {isCompressing && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ps-border)]">
              <div className="h-full w-2/3 dd-shimmer rounded-full" />
            </div>
          )}

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--ps-text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <UploadCloud className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  Uploading encrypted private POD...
                </span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ps-border)]">
                <div
                  className="h-full rounded-full bg-[var(--ps-accent)] transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {podError && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {podError}
            </p>
          )}

          {submitAttempted && podValidationError && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {podValidationError}
            </p>
          )}

          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-[var(--ps-text-muted)]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
            <span>
              Stored privately &amp; auto-purged after 48 hours per privacy policy.
            </span>
          </div>
        </div>
      )}
    </FormModal>
  );
}

export default DriverOtpPodModal;
