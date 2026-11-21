'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { generateQrCodeDataUrl } from '@/lib/payments/qr-code';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  ImagePlus,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
  Tag,
  X,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import {
  buildPlatformUpiDetails,
  type PaymentIntentRecord,
  type PaymentPurpose,
} from '@/lib/payments/types';

const PAYMENT_PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  pick_n_drop: 'Pick N Drop Escrow',
  vehicle_booking: 'Vehicle Booking Advance',
  bulletin_subscription: 'Bulletin Monthly Plan',
  bulletin_post_pass: 'Single Bulletin Post Pass',
  print_order: 'Print & Digital Order Escrow',
  print_order_with_delivery: 'Print Order + Pick N Drop Delivery',
  print_pro_subscription: 'Print & Digital Pro Subscription',
  resource_booking: 'Venue & Stay Booking Escrow',
  booking_pro_subscription: 'Booking Venue Pro Subscription',
  stay_pro_subscription: 'Hotel & Homestay Pro Subscription',
};

function formatInrAmount(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (response: RazorpaySuccessResponse) => void;
}

interface RazorpayCheckoutInstance {
  open: () => void;
  on?: (
    event: string,
    cb: (response: { error?: { description?: string } }) => void
  ) => void;
}

export interface UniversalPaymentModalProps {
  open?: boolean;
  intent: PaymentIntentRecord | null;
  upiId?: string;
  upiPayeeName?: string;
  title?: string;
  subtitle?: string;
  onSubmitted: (updatedIntent: PaymentIntentRecord) => void;
  onClose: () => void;
}

const DEFAULT_UPI_ID = 'printswift@upi';
const DEFAULT_PAYEE_NAME = 'PrintSwift Local';
const PAYMENT_RECEIPT_BUCKET = 'listing-images';
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay requires a browser environment.'));
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }
  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_SRC}"]`
    );
    if (existing) {
      if (window.Razorpay) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          razorpayScriptPromise = null;
          reject(new Error('Failed to load Razorpay Checkout SDK.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScriptPromise = null;
      reject(
        new Error(
          'Unable to reach Razorpay Checkout. Check your connection or switch to Manual UPI.'
        )
      );
    };
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '00:00';
  const totalSecs = Math.floor(remainingMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function compressReceiptImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read screenshot file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file selected.'));
      img.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(blob);
          },
          'image/webp',
          0.8
        );
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function UniversalPaymentModal({
  open = true,
  intent,
  upiId = DEFAULT_UPI_ID,
  upiPayeeName = DEFAULT_PAYEE_NAME,
  title,
  subtitle,
  onSubmitted,
  onClose,
}: UniversalPaymentModalProps) {
  const { setStatus } = useAppStatus();
  const { paymentConfig, identity } = useAppConfig();

  // Track promo / verification mutations layered on top of the current intent ID
  const [mutatedIntent, setMutatedIntent] = useState<{
    id: string;
    record: PaymentIntentRecord;
  } | null>(null);

  const activeIntent =
    intent && mutatedIntent?.id === intent.id ? mutatedIntent.record : intent;

  // Super-Admin Dual-Mode / Full-Manual switch resolution
  const canRazorpay = Boolean(
    paymentConfig.razorpay_enabled &&
      paymentConfig.payment_mode !== 'manual_only'
  );
  const canManual = Boolean(
    paymentConfig.manual_upi_enabled &&
      paymentConfig.payment_mode !== 'razorpay_only'
  );
  const showMethodTabs = canRazorpay && canManual;

  const defaultTab: 'razorpay' | 'manual_upi' = useMemo(() => {
    if (canRazorpay && !canManual) return 'razorpay';
    if (!canRazorpay) return 'manual_upi';
    return paymentConfig.default_method === 'razorpay'
      ? 'razorpay'
      : 'manual_upi';
  }, [canRazorpay, canManual, paymentConfig.default_method]);

  const [manualTabChoice, setManualTabChoice] = useState<
    'razorpay' | 'manual_upi' | null
  >(null);

  const activeMethod: 'razorpay' | 'manual_upi' = !canRazorpay
    ? 'manual_upi'
    : !canManual
      ? 'razorpay'
      : manualTabChoice ?? defaultTab;

  // Authoritative UPI credentials (Admin config takes precedence over caller fallback)
  const effectiveUpiId =
    paymentConfig.upi_id.trim() || upiId.trim() || DEFAULT_UPI_ID;
  const effectivePayee =
    paymentConfig.upi_payee_name.trim() ||
    upiPayeeName.trim() ||
    identity.app_name?.trim() ||
    DEFAULT_PAYEE_NAME;

  // Promo code state
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromoInfo, setAppliedPromoInfo] = useState<{
    intentId: string;
    code: string;
    description: string | null;
  } | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // Manual UPI state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [utrRef, setUtrRef] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(
    null
  );
  const [copiedField, setCopiedField] = useState<'upi' | 'code' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Razorpay state
  const [isLaunchingRazorpay, setIsLaunchingRazorpay] = useState(false);
  const [isVerifyingRazorpay, setIsVerifyingRazorpay] = useState(false);
  const [confirmedReceipt, setConfirmedReceipt] = useState<{
    intentId: string;
    paymentId: string;
    amountInr: number;
    intentCode: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(-1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeIntentId = activeIntent?.id ?? '';
  const activeIntentCode = activeIntent?.intent_code ?? '';
  const activeExpiresAt = activeIntent?.expires_at ?? null;

  // Reset per-intent form fields when opening a different payment intent
  useEffect(() => {
    if (!open || !activeIntentId) return;
    queueMicrotask(() => {
      setUtrRef(intent?.upi_utr_ref || '');
      setReceiptFile(null);
      setReceiptPreviewUrl(intent?.payment_proof_path || null);
      setPromoInput('');
      setPromoError(null);
      setErrorMessage(null);
    });
  }, [open, activeIntentId, intent?.upi_utr_ref, intent?.payment_proof_path]);

  // Pricing breakdown
  const baseAmountInr = useMemo(() => {
    if (!activeIntent) return 0;
    const base =
      typeof activeIntent.base_amount_inr === 'number' &&
      Number.isFinite(activeIntent.base_amount_inr)
        ? Number(activeIntent.base_amount_inr)
        : Number(activeIntent.amount_inr || 0);
    return round2(Math.max(0, base));
  }, [activeIntent]);

  const discountInr = useMemo(
    () => round2(Math.max(0, Number(activeIntent?.discount_inr || 0))),
    [activeIntent?.discount_inr]
  );

  const netAmountInr = useMemo(
    () => round2(Math.max(0, baseAmountInr - discountInr)),
    [baseAmountInr, discountInr]
  );

  const convenienceFeePct = Math.max(
    0,
    Number(paymentConfig.online_convenience_fee_pct || 0)
  );

  const razorpayConvenienceFeeInr = useMemo(
    () => round2(netAmountInr * (convenienceFeePct / 100)),
    [netAmountInr, convenienceFeePct]
  );

  const razorpayFinalAmountInr = useMemo(
    () => round2(netAmountInr + razorpayConvenienceFeeInr),
    [netAmountInr, razorpayConvenienceFeeInr]
  );

  const displayedPayableInr =
    activeMethod === 'razorpay' ? razorpayFinalAmountInr : netAmountInr;

  const isExpired = Boolean(activeExpiresAt && remainingMs === 0);

  const activePurpose = activeIntent?.purpose ?? 'pick_n_drop';
  const upiUri = useMemo(
    () =>
      activeIntentCode
        ? buildPlatformUpiDetails({
            intentCode: activeIntentCode,
            amountInr: netAmountInr,
            purpose: activePurpose,
            upiIdOverride: effectiveUpiId,
            upiPayeeNameOverride: effectivePayee,
          }).upi_deep_link
        : '',
    [effectiveUpiId, effectivePayee, netAmountInr, activeIntentCode, activePurpose]
  );

  // Live countdown for soft-hold expiration
  useEffect(() => {
    if (!open || !activeExpiresAt) {
      queueMicrotask(() => setRemainingMs(-1));
      return;
    }
    const targetMs = new Date(activeExpiresAt).getTime();
    const tick = () => {
      setRemainingMs(Math.max(0, targetMs - Date.now()));
    };
    queueMicrotask(tick);
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [open, activeExpiresAt]);

  // Generate QR code data URL when modal is open & Manual UPI is available
  useEffect(() => {
    if (!open || !canManual || !upiUri) return;
    queueMicrotask(() => {
      try {
        const url = generateQrCodeDataUrl(upiUri, {
          margin: 1,
          darkColor: '#0f172a',
          lightColor: '#ffffff',
        });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl(null);
      }
    });
  }, [open, upiUri, canManual]);

  // Escape key closes modal unless verifying or submitting
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !isSubmitting &&
        !isLaunchingRazorpay &&
        !isVerifyingRazorpay
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isSubmitting, isLaunchingRazorpay, isVerifyingRazorpay, onClose]);

  // Cleanup preview blob URL
  useEffect(() => {
    return () => {
      if (receiptPreviewUrl && receiptPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
    };
  }, [receiptPreviewUrl]);

  if (!open || !activeIntent || typeof document === 'undefined') {
    return null;
  }

  const activeReceipt =
    confirmedReceipt && confirmedReceipt.intentId === activeIntent.id
      ? confirmedReceipt
      : null;

  const activePromo =
    appliedPromoInfo && appliedPromoInfo.intentId === activeIntent.id
      ? appliedPromoInfo
      : null;

  const handleCopy = async (text: string, field: 'upi' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setStatus('success', field === 'upi' ? 'UPI ID copied' : 'Ref code copied');
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setStatus('error', 'Unable to copy to clipboard');
    }
  };

  const handleApplyPromo = async () => {
    const cleanCode = promoInput.trim().toUpperCase();
    if (!cleanCode) {
      setPromoError('Enter a promo code first.');
      return;
    }
    if (isExpired) {
      setPromoError('This payment session has expired.');
      return;
    }

    setPromoError(null);
    setErrorMessage(null);
    setIsApplyingPromo(true);

    try {
      const { data, error } = await supabase.rpc('validate_and_apply_promo', {
        p_intent_id: activeIntent.id,
        p_code: cleanCode,
      });

      if (error) {
        throw new Error(error.message || 'Promo code could not be applied.');
      }

      const payload = (data && typeof data === 'object' ? data : {}) as {
        code?: string;
        description?: string | null;
        base_amount_inr?: number;
        discount_inr?: number;
        convenience_fee_inr?: number;
        amount_inr?: number;
        payment_intent?: PaymentIntentRecord;
      };

      const nextIntent: PaymentIntentRecord = payload.payment_intent
        ? {
            ...activeIntent,
            ...payload.payment_intent,
          }
        : {
            ...activeIntent,
            base_amount_inr:
              typeof payload.base_amount_inr === 'number'
                ? payload.base_amount_inr
                : baseAmountInr,
            discount_inr:
              typeof payload.discount_inr === 'number'
                ? payload.discount_inr
                : 0,
            amount_inr:
              typeof payload.amount_inr === 'number'
                ? payload.amount_inr
                : activeIntent.amount_inr,
          };

      setMutatedIntent({ id: activeIntent.id, record: nextIntent });
      setAppliedPromoInfo({
        intentId: activeIntent.id,
        code: payload.code || cleanCode,
        description: payload.description || null,
      });
      setPromoInput('');
      setStatus(
        'success',
        `Promo applied: -${formatInrAmount(Number(nextIntent.discount_inr || 0))}`
      );
    } catch (err) {
      setPromoError(
        err instanceof Error ? err.message : 'Invalid or expired promo code.'
      );
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image screenshot (JPG, PNG, or WebP).');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setErrorMessage('Screenshot must be under 6 MB.');
      return;
    }
    setErrorMessage(null);
    if (receiptPreviewUrl && receiptPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(receiptPreviewUrl);
    }
    setReceiptFile(file);
    setReceiptPreviewUrl(URL.createObjectURL(file));
  };

  const handlePayWithRazorpay = async () => {
    setErrorMessage(null);
    if (isExpired) {
      setErrorMessage(
        'This reservation hold has expired. Please close and start a fresh checkout.'
      );
      return;
    }
    if (!canRazorpay) {
      setErrorMessage(
        'Online Razorpay checkout is currently disabled. Please use Manual UPI.'
      );
      return;
    }

    setIsLaunchingRazorpay(true);
    setStatus('saving', 'Starting Razorpay checkout...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('Please sign in again to complete payment.');
      }

      // 1. Dynamically load checkout.js from official Razorpay CDN
      await loadRazorpayCheckoutScript();
      if (!window.Razorpay) {
        throw new Error('Razorpay Checkout SDK failed to initialize.');
      }

      // 2. Create server-authoritative Razorpay Order
      const orderRes = await fetch('/api/payments/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ intent_id: activeIntent.id }),
      });

      const orderData = (await orderRes.json().catch(() => ({}))) as {
        razorpay_order_id?: string;
        amount_paise?: number;
        currency?: string;
        key_id?: string;
        convenience_fee_inr?: number;
        final_amount_inr?: number;
        error?: string;
      };

      if (
        !orderRes.ok ||
        !orderData.razorpay_order_id ||
        !orderData.key_id ||
        !orderData.amount_paise
      ) {
        throw new Error(
          orderData.error || 'Could not initialize Razorpay order.'
        );
      }

      const purposeLabel =
        PAYMENT_PURPOSE_LABELS[activeIntent.purpose] || 'Payment';
      const finalChargedInr =
        typeof orderData.final_amount_inr === 'number'
          ? orderData.final_amount_inr
          : razorpayFinalAmountInr;

      const rzp = new window.Razorpay({
        key: orderData.key_id,
        amount: orderData.amount_paise,
        currency: orderData.currency || 'INR',
        name: identity.app_name || 'PrintSwift Local',
        description: `${purposeLabel} • ${activeIntent.intent_code}`,
        order_id: orderData.razorpay_order_id,
        theme: { color: '#0284c7' },
        modal: {
          ondismiss: () => {
            setIsLaunchingRazorpay(false);
            setStatus('idle');
          },
        },
        handler: async (response: RazorpaySuccessResponse) => {
          setIsLaunchingRazorpay(false);
          setIsVerifyingRazorpay(true);
          setErrorMessage(null);
          setStatus('saving', 'Verifying payment...');

          try {
            const verifyRes = await fetch('/api/payments/razorpay/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                intent_id: activeIntent.id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
              success?: boolean;
              error?: string;
            };

            if (!verifyRes.ok || !verifyJson.success) {
              throw new Error(
                verifyJson.error ||
                  'Payment received, but verification failed. Please contact support with your payment ID.'
              );
            }

            const succeededIntent: PaymentIntentRecord = {
              ...activeIntent,
              status: 'succeeded',
              provider: 'razorpay',
              provider_order_id: orderData.razorpay_order_id || null,
              provider_payment_id: response.razorpay_payment_id,
              convenience_fee_inr:
                typeof orderData.convenience_fee_inr === 'number'
                  ? orderData.convenience_fee_inr
                  : razorpayConvenienceFeeInr,
              amount_inr: finalChargedInr,
              updated_at: new Date().toISOString(),
            };

            setMutatedIntent({ id: activeIntent.id, record: succeededIntent });
            setConfirmedReceipt({
              intentId: activeIntent.id,
              paymentId: response.razorpay_payment_id,
              amountInr: finalChargedInr,
              intentCode: activeIntent.intent_code,
            });
            setStatus('success', 'Payment confirmed instantly!');
            onSubmitted(succeededIntent);
          } catch (verifyErr) {
            const msg =
              verifyErr instanceof Error
                ? verifyErr.message
                : 'Could not verify Razorpay payment.';
            setErrorMessage(msg);
            setStatus('error', 'Verification failed');
          } finally {
            setIsVerifyingRazorpay(false);
          }
        },
      });

      rzp.on?.('payment.failed', (failure) => {
        setIsLaunchingRazorpay(false);
        setErrorMessage(
          failure?.error?.description ||
            'Payment was declined or cancelled. You can retry or switch to Manual UPI.'
        );
        setStatus('error', 'Payment failed');
      });

      rzp.open();
    } catch (err) {
      setIsLaunchingRazorpay(false);
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to open Razorpay checkout.';
      setErrorMessage(msg);
      setStatus('error', 'Checkout failed');
    }
  };

  const handleSubmitManualProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (isExpired) {
      setErrorMessage(
        'This reservation hold has expired. Please close and start a fresh booking.'
      );
      return;
    }

    const cleanUtr = utrRef.trim().replace(/\s+/g, '').toUpperCase();
    if (cleanUtr.length < 8 || cleanUtr.length > 32) {
      setErrorMessage(
        'Please enter a valid 12-digit UPI UTR / Transaction Reference Number (8–32 characters).'
      );
      return;
    }

    setIsSubmitting(true);
    setStatus('saving', 'Submitting UPI proof...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('Please sign in again to submit payment proof.');
      }

      let uploadedProofPath: string | null =
        activeIntent.payment_proof_path || null;

      if (receiptFile) {
        const compressedBlob = await compressReceiptImage(receiptFile);
        const filePath = `payment-proofs/${activeIntent.user_id}/${activeIntent.intent_code}-${Date.now()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from(PAYMENT_RECEIPT_BUCKET)
          .upload(filePath, compressedBlob, {
            contentType: 'image/webp',
            upsert: true,
          });
        if (!uploadError) {
          const { data: pub } = supabase.storage
            .from(PAYMENT_RECEIPT_BUCKET)
            .getPublicUrl(filePath);
          uploadedProofPath = pub?.publicUrl || filePath;
        }
      }

      const submitRes = await fetch('/api/payments/submit-utr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intentId: activeIntent.id,
          upiUtrRef: cleanUtr,
          paymentProofPath: uploadedProofPath,
        }),
      });

      const submitJson = (await submitRes.json().catch(() => ({}))) as {
        ok?: boolean;
        intent?: PaymentIntentRecord;
        error?: string;
      };

      if (!submitRes.ok || !submitJson.intent) {
        throw new Error(
          submitJson.error ||
            'Could not submit payment proof. This payment session may have expired or already been submitted.'
        );
      }

      setMutatedIntent({
        id: activeIntent.id,
        record: submitJson.intent,
      });
      setStatus('success', 'UTR submitted for verification');
      onSubmitted(submitJson.intent);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit payment proof.';
      setErrorMessage(msg);
      setStatus('error', 'Payment proof failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const purposeLabel =
    PAYMENT_PURPOSE_LABELS[activeIntent.purpose] || 'Payment';

  const modalHeading = activeReceipt
    ? 'Payment Confirmed!'
    : title ||
      (activeMethod === 'razorpay'
        ? 'Instant Online Payment'
        : 'Complete UPI Payment');

  const modalContent = (
    <div
      className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-payment-modal-title"
      data-testid="universal-payment-modal"
    >
      <div className="w-full sm:max-w-md max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
              <h2
                id="universal-payment-modal-title"
                className="text-sm font-bold truncate"
              >
                {modalHeading}
              </h2>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)] truncate mt-0.5">
              {subtitle || purposeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isLaunchingRazorpay || isVerifyingRazorpay}
            aria-label="Close payment modal"
            className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Instant Confirmation Receipt State (Razorpay) */}
        {activeReceipt ? (
          <div
            data-testid="payment-confirmed-receipt"
            className="p-6 text-center space-y-4 overflow-y-auto"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-[var(--ps-text)]">
                Payment Confirmed!
              </h3>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Your booking / service has been verified and activated immediately.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-left space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ps-text-muted)]">Amount Paid</span>
                <span className="font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatInrAmount(activeReceipt.amountInr)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ps-text-muted)]">Order Ref</span>
                <span className="font-mono font-bold">
                  {activeReceipt.intentCode}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--ps-text-muted)]">Razorpay ID</span>
                <span className="font-mono text-[11px] truncate max-w-[190px]">
                  {activeReceipt.paymentId}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full h-9 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 transition-opacity"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3.5 overflow-y-auto custom-scrollbar">
            {/* Amount + Reference Code + Soft-Hold Countdown Strip */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Amount to Pay
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold tracking-tight text-[var(--ps-text)] tabular-nums">
                      {formatInrAmount(displayedPayableInr)}
                    </span>
                    {discountInr > 0 && (
                      <span className="text-xs font-semibold line-through text-[var(--ps-text-muted)] tabular-nums">
                        {formatInrAmount(baseAmountInr)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] block">
                    Ref Code
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(activeIntent.intent_code, 'code')
                    }
                    className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] font-mono text-xs font-bold text-[var(--ps-accent)] hover:border-[var(--ps-accent)] transition-colors"
                  >
                    <span>{activeIntent.intent_code}</span>
                    {copiedField === 'code' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Live Discount & Convenience Fee Breakdown */}
              {(discountInr > 0 ||
                (activeMethod === 'razorpay' && razorpayConvenienceFeeInr > 0)) && (
                <div className="pt-2 border-t border-[var(--ps-border)]/70 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-[var(--ps-text-muted)]">
                    <span>Base Amount</span>
                    <span className="tabular-nums font-semibold text-[var(--ps-text)]">
                      {formatInrAmount(baseAmountInr)}
                    </span>
                  </div>
                  {discountInr > 0 && (
                    <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        Promo Discount
                        {activePromo ? ` (${activePromo.code})` : ''}
                      </span>
                      <span className="tabular-nums">
                        -{formatInrAmount(discountInr)}
                      </span>
                    </div>
                  )}
                  {activeMethod === 'razorpay' &&
                    razorpayConvenienceFeeInr > 0 && (
                      <div className="flex items-center justify-between text-[var(--ps-text-muted)]">
                        <span>
                          Online Convenience Fee ({convenienceFeePct}%)
                        </span>
                        <span className="tabular-nums font-semibold text-[var(--ps-text)]">
                          +{formatInrAmount(razorpayConvenienceFeeInr)}
                        </span>
                      </div>
                    )}
                </div>
              )}

              {activeIntent.expires_at && remainingMs >= 0 && (
                <div
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                    isExpired
                      ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    {isExpired
                      ? 'Hold expired — please re-book'
                      : 'Slot locked while you pay'}
                  </span>
                  <span className="font-mono font-bold tabular-nums">
                    {formatCountdown(remainingMs)}
                  </span>
                </div>
              )}
            </div>

            {/* Compact Promo Code Strip */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Tag className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => {
                      setPromoInput(e.target.value.toUpperCase());
                      if (promoError) setPromoError(null);
                    }}
                    placeholder="Have a promo code?"
                    disabled={isApplyingPromo || isExpired}
                    data-testid="payment-promo-input"
                    className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-mono uppercase tracking-wide text-[var(--ps-text)] placeholder:normal-case placeholder:font-sans placeholder:tracking-normal placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleApplyPromo()}
                  disabled={isApplyingPromo || isExpired || !promoInput.trim()}
                  data-testid="payment-promo-apply-btn"
                  className="h-8 px-3 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)] text-xs font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                >
                  {isApplyingPromo ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Apply</span>
                  )}
                </button>
              </div>
              {activePromo && discountInr > 0 && (
                <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>
                    {activePromo.code} applied — saved{' '}
                    {formatInrAmount(discountInr)}
                    {activePromo.description
                      ? ` (${activePromo.description})`
                      : ''}
                  </span>
                </p>
              )}
              {promoError && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {promoError}
                </p>
              )}
            </div>

            {/* Dual-Mode Method Switcher (ONLY shown when both Razorpay & Manual UPI are enabled) */}
            {showMethodTabs && (
              <div
                role="tablist"
                aria-label="Choose payment method"
                className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMethod === 'razorpay'}
                  data-testid="payment-tab-razorpay"
                  onClick={() => {
                    setManualTabChoice('razorpay');
                    setErrorMessage(null);
                  }}
                  className={`h-8 px-2.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                    activeMethod === 'razorpay'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Pay Instantly</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMethod === 'manual_upi'}
                  data-testid="payment-tab-manual-upi"
                  onClick={() => {
                    setManualTabChoice('manual_upi');
                    setErrorMessage(null);
                  }}
                  className={`h-8 px-2.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                    activeMethod === 'manual_upi'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Manual UPI</span>
                </button>
              </div>
            )}

            {/* Shared Error Alert */}
            {errorMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* TAB A: RAZORPAY INSTANT CHECKOUT (Only if Super-Admin enabled) */}
            {activeMethod === 'razorpay' && canRazorpay && (
              <div
                data-testid="payment-panel-razorpay"
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3.5"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[var(--ps-accent)]/12 border border-[var(--ps-accent)]/25 text-[var(--ps-accent)] flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-xs font-bold text-[var(--ps-text)]">
                      Instant Verification via Razorpay
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
                      Pay via GPay, PhonePe, Paytm UPI, RuPay/Visa/Mastercard,
                      or NetBanking with automatic instant confirmation.
                    </p>
                  </div>
                </div>

                {razorpayConvenienceFeeInr > 0 && (
                  <div className="rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] px-3 py-2 text-[11px] text-[var(--ps-text-muted)] flex items-center justify-between">
                    <span>Includes {convenienceFeePct}% online gateway fee</span>
                    <span className="font-bold text-[var(--ps-text)] tabular-nums">
                      +{formatInrAmount(razorpayConvenienceFeeInr)}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handlePayWithRazorpay()}
                  disabled={
                    isLaunchingRazorpay || isVerifyingRazorpay || isExpired
                  }
                  data-testid="payment-razorpay-btn"
                  className="w-full h-10 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity disabled:opacity-50 shadow-xs"
                >
                  {isVerifyingRazorpay ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying Payment...</span>
                    </>
                  ) : isLaunchingRazorpay ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Opening Razorpay...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      <span>
                        Pay {formatInrAmount(razorpayFinalAmountInr)} Instantly
                      </span>
                    </>
                  )}
                </button>

                <p className="text-[10px] text-center text-[var(--ps-text-muted)]">
                  Secured by Razorpay 256-bit encryption. Zero manual wait time.
                </p>
              </div>
            )}

            {/* TAB B: MANUAL UPI + QR + 12-DIGIT UTR SUBMISSION */}
            {activeMethod === 'manual_upi' && (
              <div
                data-testid="payment-panel-manual-upi"
                className="space-y-3.5"
              >
                {/* Step 1: 1-Tap UPI Launch + QR Code */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      Step 1: Pay via any UPI App
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                      GPay · PhonePe · Paytm
                    </span>
                  </div>

                  <a
                    href={upiUri}
                    className="w-full h-9 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity shadow-xs"
                  >
                    <span>
                      Open UPI App ({formatInrAmount(netAmountInr)})
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
                    <div className="w-28 h-28 rounded-xl border border-[var(--ps-border)] bg-white p-1.5 flex items-center justify-center shrink-0">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt={`UPI QR code for ${effectivePayee}`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <QrCode className="w-10 h-10 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5 text-center sm:text-left">
                      <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
                        Scan with any UPI scanner or copy UPI ID below. Include
                        ref{' '}
                        <strong className="text-[var(--ps-text)] font-mono">
                          {activeIntent.intent_code}
                        </strong>{' '}
                        in the note.
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleCopy(effectiveUpiId, 'upi')}
                        className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-mono font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center gap-1.5 max-w-full"
                      >
                        <span className="truncate">{effectiveUpiId}</span>
                        {copiedField === 'upi' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-[var(--ps-text-muted)] shrink-0" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 2: Submit 12-Digit UTR + Optional Screenshot */}
                <form
                  onSubmit={handleSubmitManualProof}
                  className="space-y-3"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="universal-utr-input"
                      className="text-xs font-bold flex items-center justify-between"
                    >
                      <span>Step 2: Enter 12-Digit UTR / Ref No.</span>
                      <span className="text-[10px] font-semibold text-rose-500">
                        Required
                      </span>
                    </label>
                    <input
                      id="universal-utr-input"
                      type="text"
                      value={utrRef}
                      onChange={(e) => setUtrRef(e.target.value)}
                      placeholder="e.g. 432198765432"
                      maxLength={32}
                      required
                      disabled={isSubmitting || isExpired}
                      data-testid="payment-utr-input"
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-sm font-mono tracking-wide text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
                    />
                  </div>

                  {/* Optional Receipt Screenshot */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[var(--ps-text-muted)]">
                        Payment Screenshot (Optional)
                      </span>
                      {receiptPreviewUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setReceiptFile(null);
                            setReceiptPreviewUrl(null);
                            if (fileInputRef.current)
                              fileInputRef.current.value = '';
                          }}
                          className="text-rose-500 hover:underline font-semibold"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {receiptPreviewUrl ? (
                      <div className="flex items-center gap-2.5 p-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                        <img
                          src={receiptPreviewUrl}
                          alt="Payment screenshot preview"
                          className="w-12 h-12 rounded-lg object-cover border border-[var(--ps-border)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">
                            {receiptFile?.name || 'Receipt attached'}
                          </div>
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            Ready to attach with UTR
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubmitting || isExpired}
                        className="w-full h-8 px-3 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        <span>Attach UPI Receipt Screenshot</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isSubmitting}
                      className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || isExpired || !utrRef.trim()}
                      data-testid="payment-submit-proof-btn"
                      className="flex-1 h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Submit Payment Proof</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
