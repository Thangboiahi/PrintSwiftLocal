'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileCheck2,
  FileText,
  FileUp,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Minus,
  Package,
  Phone,
  Plus,
  Printer,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { PageSubNavPill } from '@/components/navigation/PageSubNavPill';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { generateQrCodeDataUrl } from '@/lib/payments/qr-code';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { convertImagesToPdfFile } from '@/lib/print-orders/client-photo-to-pdf';
import type {
  ListingPrintProfile,
  PagesPerSheetOption,
  PrintCapabilities,
  PrintColorMode,
  PrintFileOptions,
  PrintHandoverMode,
  PrintJobMode,
  PrintOrder,
  PrintOrderFile,
  PrintPaperSize,
  PrintPaymentRail,
  PrintQuoteSnapshot,
  PrintTurnaroundBadge,
} from '@/lib/print-orders/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';

export interface PrintShopListingSummary {
  id: string;
  title: string;
  locality: string;
  address: string | null;
  hub_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PrintOrderClientProps {
  listing: PrintShopListingSummary;
  profile: ListingPrintProfile | null;
  hasActiveEntitlement: boolean;
  isPrintModuleEnabled: boolean;
  hubPauseMessage: string | null;
}

interface LocalFileConfig {
  color_mode: PrintColorMode;
  duplex: boolean;
  paper_size: PrintPaperSize;
  page_range: string;
  pages_per_sheet: PagesPerSheetOption;
  copies: number;
  binding: boolean;
  lamination: boolean;
}

interface ShopDirectUpiDetails {
  upiId: string;
  payeeName: string;
  amountInr: number;
  orderCode: string;
  upiUri: string;
  verified: boolean;
}

interface SubmittedInstantConfirmation {
  order: PrintOrder;
  collectionOtp: string;
  paymentRail: PrintPaymentRail;
  shopUpi: ShopDirectUpiDetails | null;
  escrowPaid?: boolean;
}

const CUSTOM_DIGITAL_SERVICES = [
  {
    value: 'graphic_banner_design',
    label: 'Graphic & Banner Design',
    description: 'Posters, flex banners, invitations, cards & layouts',
  },
  {
    value: 'online_form_exam_assistance',
    label: 'Online Form & Exam Assistance',
    description: 'Scholarship, exam, government & admission portal filing',
  },
  {
    value: 'typing_formatting',
    label: 'Typing & Formatting',
    description: 'Project reports, thesis formatting, resumes & letters',
  },
  {
    value: 'file_conversion_dtp',
    label: 'File Conversion & DTP',
    description: 'PDF editing, desktop publishing & multi-language DTP',
  },
  {
    value: 'scanning_document_prep',
    label: 'Scanning & Document Prep',
    description: 'High-DPI scans, PDF merging & size-optimized uploads',
  },
];

const TURNAROUND_META: Record<
  PrintTurnaroundBadge,
  { label: string; cls: string }
> = {
  express_30m: {
    label: 'Express ~30m',
    cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
  same_day: {
    label: 'Same-Day',
    cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
  },
  next_day: {
    label: 'Next-Day',
    cls: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
};

const CAPABILITY_LABELS: Array<{
  key: keyof PrintCapabilities;
  label: string;
}> = [
  { key: 'bw_a4', label: 'B&W A4 Print' },
  { key: 'color_a4', label: 'Color A4 Print' },
  { key: 'duplex', label: 'Double-Sided (Duplex)' },
  { key: 'a3_large', label: 'A3 Large Format' },
  { key: 'spiral_binding', label: 'Spiral Binding' },
  { key: 'lamination', label: 'Lamination' },
  { key: 'custom_digital_jobs', label: 'Custom Digital & Design' },
  { key: 'sealed_envelope', label: 'Sealed Privacy Envelope' },
];

function formatInr(value: number): string {
  const num = Number.isFinite(value) ? value : 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatResumeTime(iso: string | null): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function isCapabilitySupported(
  profile: ListingPrintProfile | null,
  key: keyof PrintCapabilities
): boolean {
  if (!profile) return false;
  if (!profile.capabilities[key]) return false;
  if (profile.verified_capabilities[key] === false) return false;
  return true;
}

function createDefaultFileConfig(): LocalFileConfig {
  return {
    color_mode: 'bw',
    duplex: false,
    paper_size: 'A4',
    page_range: 'all',
    pages_per_sheet: 1,
    copies: 1,
    binding: false,
    lamination: false,
  };
}

export function PrintOrderClient({
  listing,
  profile,
  hasActiveEntitlement,
  isPrintModuleEnabled,
  hubPauseMessage,
}: PrintOrderClientProps) {
  const { user: authUser, session: activeSession } = useAuth();
  const { paymentConfig } = useAppConfig();
  const isAuthenticated = Boolean(authUser?.id || activeSession?.user?.id);

  // Determine mode availability
  const canCustomDigital = isCapabilitySupported(profile, 'custom_digital_jobs');
  const canColor = isCapabilitySupported(profile, 'color_a4');
  const canDuplex = isCapabilitySupported(profile, 'duplex');
  const canA3 = isCapabilitySupported(profile, 'a3_large');
  const canSpiralBinding = isCapabilitySupported(profile, 'spiral_binding');
  const canLamination = isCapabilitySupported(profile, 'lamination');
  const canSealedEnvelope = isCapabilitySupported(profile, 'sealed_envelope');

  const [nowMs, setNowMs] = useState<number>(0);
  const busyUntilIso = profile?.busy_until ?? null;
  const isBusyPaused = Boolean(
    nowMs > 0 &&
      busyUntilIso &&
      Number.isFinite(new Date(busyUntilIso).getTime()) &&
      new Date(busyUntilIso).getTime() > nowMs
  );

  const isOfficialPrintSwift = Boolean(
    profile?.is_official_printswift || profile?.is_first_party_printswift
  );
  const supportsPickNDropDelivery = profile?.supports_pick_n_drop !== false;

  const isPreLaunchPreview = Boolean(
    profile && isOfficialPrintSwift && !profile.is_accepting_orders
  );
  const isTemporarilyPaused = Boolean(
    profile && !isPreLaunchPreview && (!profile.is_accepting_orders || isBusyPaused)
  );
  const isOrderable = Boolean(
    isPrintModuleEnabled &&
      (hasActiveEntitlement || isOfficialPrintSwift) &&
      profile &&
      !isPreLaunchPreview &&
      !isTemporarilyPaused
  );

  // Mode tab state (honors ?mode=custom_digital deep link post-hydration)
  const [jobMode, setJobMode] = useState<PrintJobMode>('instant_print');

  useEffect(() => {
    queueMicrotask(() => {
      setNowMs(Date.now());
      if (typeof window !== 'undefined' && canCustomDigital) {
        const modeParam = new URLSearchParams(window.location.search)
          .get('mode')
          ?.trim()
          .toLowerCase();
        if (modeParam === 'custom_digital') {
          setJobMode('custom_digital');
        }
      }
    });
  }, [canCustomDigital]);

  // Tab A (Instant Print) state
  const [instantOrderId, setInstantOrderId] = useState<string | null>(null);
  const [instantFiles, setInstantFiles] = useState<PrintOrderFile[]>([]);
  const [fileConfigs, setFileConfigs] = useState<Record<string, LocalFileConfig>>(
    {}
  );
  const [handoverMode, setHandoverMode] =
    useState<PrintHandoverMode>('walk_in_pickup');
  const [sealedEnvelope, setSealedEnvelope] = useState<boolean>(false);

  // Upload state
  const [isStitchingPhotos, setIsStitchingPhotos] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState<string | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Quote & payment state
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteSnapshot, setQuoteSnapshot] = useState<PrintQuoteSnapshot | null>(
    null
  );
  const [allowedRails, setAllowedRails] = useState<PrintPaymentRail[]>([]);
  const [forcedEscrow, setForcedEscrow] = useState<boolean>(false);
  const [forcedEscrowReason, setForcedEscrowReason] = useState<string | null>(
    null
  );
  const [selectedRail, setSelectedRail] =
    useState<PrintPaymentRail>('platform_escrow');

  // Submission & modal state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [instantConfirmation, setInstantConfirmation] =
    useState<SubmittedInstantConfirmation | null>(null);
  const [pendingEscrowOrder, setPendingEscrowOrder] = useState<{
    order: PrintOrder;
    collectionOtp: string;
  } | null>(null);
  const [activePaymentIntent, setActivePaymentIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [escrowUpiOverride, setEscrowUpiOverride] = useState<{
    upiId?: string;
    payeeName?: string;
  }>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Tab B (Custom Digital) state
  const [customServiceSlug, setCustomServiceSlug] = useState<string>(
    CUSTOM_DIGITAL_SERVICES[0].value
  );
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [customOrderId, setCustomOrderId] = useState<string | null>(null);
  const [customFiles, setCustomFiles] = useState<PrintOrderFile[]>([]);
  const [isUploadingCustom, setIsUploadingCustom] = useState(false);
  const [customUploadError, setCustomUploadError] = useState<string | null>(null);
  const [isSubmittingCustom, setIsSubmittingCustom] = useState(false);
  const [customSubmitError, setCustomSubmitError] = useState<string | null>(null);
  const [customConfirmation, setCustomConfirmation] = useState<PrintOrder | null>(
    null
  );

  // File input refs
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const customFileInputRef = useRef<HTMLInputElement | null>(null);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const copyText = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  }, []);

  // Upload files for Instant Print (supports multiple PDFs + multi-photo auto-stitching)
  const handleInstantFilesSelected = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return;
      setUploadError(null);
      setSubmitError(null);

      const token = await getAccessToken();
      if (!token) {
        setUploadError('Please sign in first to upload documents for printing.');
        return;
      }

      const rawFiles = Array.from(fileList);
      const imageFiles: File[] = [];
      const pdfFiles: File[] = [];
      const unsupportedNames: string[] = [];

      for (const file of rawFiles) {
        const mime = (file.type || '').toLowerCase();
        const lowerName = file.name.toLowerCase();
        if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
          pdfFiles.push(file);
        } else if (
          mime === 'image/jpeg' ||
          mime === 'image/png' ||
          mime === 'image/webp' ||
          /\.(jpe?g|png|webp)$/i.test(lowerName)
        ) {
          imageFiles.push(file);
        } else {
          unsupportedNames.push(file.name);
        }
      }

      if (unsupportedNames.length > 0 && pdfFiles.length === 0 && imageFiles.length === 0) {
        setUploadError(
          `Unsupported file format (${unsupportedNames[0]}). Please upload PDF documents or JPEG/PNG/WebP photos.`
        );
        return;
      }

      const filesToUpload: File[] = [...pdfFiles];

      try {
        if (imageFiles.length > 0) {
          setIsStitchingPhotos(true);
          setUploadProgressText(
            `Compressing & stitching ${imageFiles.length} photo${imageFiles.length === 1 ? '' : 's'} to PDF...`
          );
          const stitchedPdf = await convertImagesToPdfFile(
            imageFiles,
            `scanned-photos-${Date.now()}.pdf`
          );
          filesToUpload.push(stitchedPdf);
          setIsStitchingPhotos(false);
        }

        if (filesToUpload.length === 0) return;

        setIsUploading(true);
        let currentOrderId = instantOrderId;

        for (let i = 0; i < filesToUpload.length; i += 1) {
          const uploadFile = filesToUpload[i];
          setUploadProgressText(
            `Uploading & verifying document ${i + 1} of ${filesToUpload.length}...`
          );

          const formData = new FormData();
          formData.append('file', uploadFile);
          formData.append('listingId', listing.id);
          formData.append('jobMode', 'instant_print');
          if (currentOrderId) {
            formData.append('orderId', currentOrderId);
          }

          const res = await fetch('/api/print-orders/upload', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          const payload = (await res.json().catch(() => null)) as {
            orderId?: string;
            fileRecord?: PrintOrderFile;
            error?: string;
            code?: string;
          } | null;

          if (!res.ok || !payload?.fileRecord || !payload?.orderId) {
            const friendlyError =
              payload?.code === 'PDF_ENCRYPTED'
                ? 'This PDF is password-protected or encrypted. Please unlock/print-to-PDF without a password and try again.'
                : payload?.error || 'Could not upload and verify this document.';
            setUploadError(friendlyError);
            break;
          }

          currentOrderId = payload.orderId;
          setInstantOrderId(payload.orderId);
          const uploadedRecord = payload.fileRecord;
          setInstantFiles((prev) => [...prev, uploadedRecord]);
          setFileConfigs((prev) => ({
            ...prev,
            [uploadedRecord.id]: createDefaultFileConfig(),
          }));
        }
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Failed to prepare or upload your document.'
        );
      } finally {
        setIsStitchingPhotos(false);
        setIsUploading(false);
        setUploadProgressText(null);
      }
    },
    [getAccessToken, instantOrderId, listing.id]
  );

  // Remove a file locally from draft list (and mark purged in DB if allowed or reset draft)
  const handleRemoveLocalInstantFile = useCallback((fileId: string) => {
    setInstantFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      if (next.length === 0) {
        setInstantOrderId(null);
        setQuoteSnapshot(null);
      }
      return next;
    });
    setFileConfigs((prev) => {
      const copy = { ...prev };
      delete copy[fileId];
      return copy;
    });
  }, []);

  // Update a single file option
  const updateFileConfig = useCallback(
    (fileId: string, patch: Partial<LocalFileConfig>) => {
      setFileConfigs((prev) => {
        const current = prev[fileId] || createDefaultFileConfig();
        return {
          ...prev,
          [fileId]: {
            ...current,
            ...patch,
          },
        };
      });
    },
    []
  );

  // Build fileOptions payload for quote & create APIs
  const fileOptionsPayload = useMemo(() => {
    return instantFiles.map((file) => {
      const cfg = fileConfigs[file.id] || createDefaultFileConfig();
      const options: PrintFileOptions = {
        color_mode: canColor ? cfg.color_mode : 'bw',
        duplex: canDuplex ? cfg.duplex : false,
        paper_size: canA3 ? cfg.paper_size : 'A4',
        page_range: cfg.page_range.trim() || 'all',
        pages_per_sheet: cfg.pages_per_sheet,
        copies: Math.max(1, Math.min(200, Math.floor(cfg.copies || 1))),
        binding: canSpiralBinding ? cfg.binding : false,
        lamination: canLamination ? cfg.lamination : false,
      };
      return {
        fileId: file.id,
        options,
      };
    });
  }, [
    instantFiles,
    fileConfigs,
    canColor,
    canDuplex,
    canA3,
    canSpiralBinding,
    canLamination,
  ]);

  // Debounced 400ms live quote calculation
  const serializedQuoteDeps = useMemo(
    () =>
      JSON.stringify({
        instantOrderId,
        fileOptionsPayload,
        handoverMode,
        sealedEnvelope: canSealedEnvelope ? sealedEnvelope : false,
      }),
    [
      instantOrderId,
      fileOptionsPayload,
      handoverMode,
      sealedEnvelope,
      canSealedEnvelope,
    ]
  );

  useEffect(() => {
    if (
      !isOrderable ||
      jobMode !== 'instant_print' ||
      !instantOrderId ||
      instantFiles.length === 0
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      setIsQuoting(true);
      setQuoteError(null);

      try {
        const res = await fetch('/api/print-orders/quote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orderId: instantOrderId,
            listingId: listing.id,
            handoverMode,
            sealedEnvelopeRequested: canSealedEnvelope ? sealedEnvelope : false,
            fileOptions: fileOptionsPayload,
          }),
        });

        const payload = (await res.json().catch(() => null)) as {
          quoteSnapshot?: PrintQuoteSnapshot;
          allowedPaymentRails?: PrintPaymentRail[];
          forcedEscrow?: boolean;
          forcedEscrowReason?: string | null;
          error?: string;
        } | null;

        if (cancelled) return;

        if (!res.ok || !payload?.quoteSnapshot) {
          setQuoteError(
            payload?.error || 'Unable to compute live quote right now.'
          );
          return;
        }

        const rails = payload.allowedPaymentRails || ['platform_escrow'];
        setQuoteSnapshot(payload.quoteSnapshot);
        setAllowedRails(rails);
        setForcedEscrow(Boolean(payload.forcedEscrow));
        setForcedEscrowReason(payload.forcedEscrowReason || null);

        setSelectedRail((prev) => {
          if (payload.forcedEscrow) return 'platform_escrow';
          if (rails.includes(prev)) return prev;
          return rails[0] || 'platform_escrow';
        });
      } catch (err) {
        if (!cancelled) {
          setQuoteError(
            err instanceof Error ? err.message : 'Network error calculating quote.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsQuoting(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    serializedQuoteDeps,
    isOrderable,
    jobMode,
    instantOrderId,
    instantFiles.length,
    listing.id,
    handoverMode,
    sealedEnvelope,
    canSealedEnvelope,
    fileOptionsPayload,
    getAccessToken,
  ]);

  // Submit Instant Print Order
  const handleSubmitInstantOrder = async () => {
    if (!instantOrderId || instantFiles.length === 0) return;
    setSubmitError(null);

    const token = await getAccessToken();
    if (!token) {
      setSubmitError('Please sign in before submitting your print order.');
      return;
    }

    setIsSubmitting(true);
    try {
      const effectiveRail: PrintPaymentRail = forcedEscrow
        ? 'platform_escrow'
        : selectedRail;

      const res = await fetch('/api/print-orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: instantOrderId,
          listingId: listing.id,
          jobMode: 'instant_print',
          handoverMode,
          sealedEnvelopeRequested: canSealedEnvelope ? sealedEnvelope : false,
          paymentRail: effectiveRail,
          fileOptions: fileOptionsPayload,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        order?: PrintOrder;
        paymentIntent?: PaymentIntentRecord;
        upiDetails?: { upiId?: string; payeeName?: string };
        collectionOtp?: string;
        shopUpi?: ShopDirectUpiDetails | null;
        error?: string;
      } | null;

      if (!res.ok || !payload?.order) {
        setSubmitError(
          payload?.error || 'Could not submit your print order. Please try again.'
        );
        return;
      }

      const otp =
        payload.collectionOtp ||
        payload.order.collection_otp_display_for_customer ||
        '----';

      if (effectiveRail === 'platform_escrow' && payload.paymentIntent) {
        setPendingEscrowOrder({
          order: payload.order,
          collectionOtp: otp,
        });
        setEscrowUpiOverride({
          upiId: payload.upiDetails?.upiId,
          payeeName: payload.upiDetails?.payeeName,
        });
        setActivePaymentIntent(payload.paymentIntent);
      } else {
        setInstantConfirmation({
          order: payload.order,
          collectionOtp: otp,
          paymentRail: effectiveRail,
          shopUpi: payload.shopUpi || null,
        });
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Unexpected network error submitting your print order.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Upload optional reference file for Custom Digital Job
  const handleCustomFilesSelected = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setCustomUploadError(null);

      const token = await getAccessToken();
      if (!token) {
        setCustomUploadError('Please sign in first to attach reference files.');
        return;
      }

      const rawFiles = Array.from(fileList);
      const imageFiles = rawFiles.filter(
        (f) =>
          f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name)
      );
      const pdfFiles = rawFiles.filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );

      const filesToUpload: File[] = [...pdfFiles];

      setIsUploadingCustom(true);
      try {
        if (imageFiles.length > 0) {
          const stitched = await convertImagesToPdfFile(
            imageFiles,
            `reference-${Date.now()}.pdf`
          );
          filesToUpload.push(stitched);
        }

        if (filesToUpload.length === 0) {
          setCustomUploadError(
            'Please select a PDF document or JPEG/PNG/WebP reference photo.'
          );
          return;
        }

        let currentOrderId = customOrderId;
        for (const f of filesToUpload) {
          const formData = new FormData();
          formData.append('file', f);
          formData.append('listingId', listing.id);
          formData.append('jobMode', 'custom_digital');
          if (currentOrderId) {
            formData.append('orderId', currentOrderId);
          }

          const res = await fetch('/api/print-orders/upload', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          const payload = (await res.json().catch(() => null)) as {
            orderId?: string;
            fileRecord?: PrintOrderFile;
            error?: string;
          } | null;

          if (!res.ok || !payload?.fileRecord || !payload?.orderId) {
            setCustomUploadError(
              payload?.error || 'Failed to upload reference document.'
            );
            break;
          }

          currentOrderId = payload.orderId;
          setCustomOrderId(payload.orderId);
          setCustomFiles((prev) => [...prev, payload.fileRecord!]);
        }
      } catch (err) {
        setCustomUploadError(
          err instanceof Error ? err.message : 'Failed to upload reference file.'
        );
      } finally {
        setIsUploadingCustom(false);
      }
    },
    [customOrderId, getAccessToken, listing.id]
  );

  // Submit Custom Digital Job
  const handleSubmitCustomDigital = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomSubmitError(null);

    if (customInstructions.trim().length < 5) {
      setCustomSubmitError(
        'Please describe your job requirements in at least a few words.'
      );
      return;
    }

    const token = await getAccessToken();
    if (!token) {
      setCustomSubmitError('Please sign in before submitting a quote request.');
      return;
    }

    setIsSubmittingCustom(true);
    try {
      const res = await fetch('/api/print-orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: customOrderId || undefined,
          listingId: listing.id,
          jobMode: 'custom_digital',
          serviceCategorySlug: customServiceSlug,
          customerInstructions: customInstructions.trim(),
          handoverMode: 'walk_in_pickup',
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        order?: PrintOrder;
        error?: string;
      } | null;

      if (!res.ok || !payload?.order) {
        setCustomSubmitError(
          payload?.error || 'Could not submit your custom digital quote request.'
        );
        return;
      }

      setCustomConfirmation(payload.order);
    } catch (err) {
      setCustomSubmitError(
        err instanceof Error
          ? err.message
          : 'Network error submitting custom quote request.'
      );
    } finally {
      setIsSubmittingCustom(false);
    }
  };

  // Reset Instant Print flow for a fresh order
  const handleResetInstantFlow = () => {
    setInstantOrderId(null);
    setInstantFiles([]);
    setFileConfigs({});
    setQuoteSnapshot(null);
    setQuoteError(null);
    setUploadError(null);
    setSubmitError(null);
    setInstantConfirmation(null);
    setPendingEscrowOrder(null);
  };

  const shopUpiUri = instantConfirmation?.shopUpi?.upiUri ?? null;
  const directShopQrUrl = useMemo(() => {
    if (!shopUpiUri) return null;
    return generateQrCodeDataUrl(shopUpiUri, {
      margin: 2,
      darkColor: '#0f172a',
      lightColor: '#ffffff',
    });
  }, [shopUpiUri]);

  const turnaroundMeta = profile
    ? TURNAROUND_META[profile.turnaround_badge] || TURNAROUND_META.same_day
    : TURNAROUND_META.same_day;

  const turnaroundLabel =
    profile?.turnaround_badge === 'express_30m' && profile.express_eta_mins
      ? `Express ~${profile.express_eta_mins}m`
      : turnaroundMeta.label;

  const activeRateCard = profile?.pricing_matrix || profile?.rate_card || {};

  const confirmedCapabilities = useMemo(() => {
    if (!profile) return [];
    return CAPABILITY_LABELS.filter((item) =>
      isCapabilitySupported(profile, item.key)
    );
  }, [profile]);

  const resumeFormatted = formatResumeTime(profile?.busy_until ?? null);

  return (
    <div
      data-testid="print-order-page"
      className="mx-auto w-full max-w-5xl pb-24 lg:pb-12"
    >
      {/* Compact Sticky Back-Navigation Pill */}
      <div className="px-4 sm:px-6">
        <PageSubNavPill
          backHref={`/listing/${listing.id}`}
          backLabel="Back to Listing"
          backTestId="print-back-to-listing"
          trailing={
            isOrderable && profile ? (
              <>
                <span
                  className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold ${turnaroundMeta.cls}`}
                >
                  <Clock className="h-3 w-3" />
                  <span>{turnaroundLabel}</span>
                </span>
                <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/12 px-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Accepting Orders</span>
                </span>
              </>
            ) : isPreLaunchPreview ? (
              <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-indigo-500/35 bg-indigo-500/12 px-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                <Sparkles className="h-3 w-3" />
                <span>Pre-Launch Preview</span>
              </span>
            ) : (
              <span className="inline-flex h-7 items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/12 px-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                <Clock className="h-3 w-3" />
                <span>Unavailable</span>
              </span>
            )
          }
        >
          <div className="min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate max-w-[180px] sm:max-w-[280px] text-xs sm:text-sm font-bold text-[var(--ps-text)]">
                {listing.title}
              </h1>
              {profile?.is_first_party_printswift && (
                <span className="shrink-0 rounded-md border border-theme-primary/35 bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                  Official
                </span>
              )}
            </div>
          </div>
        </PageSubNavPill>
      </div>

      <div className="space-y-4 px-4 sm:px-6 pt-4">
        {/* Cross-Hub Awareness Banner */}
        <CrossHubBanner
          itemHubId={listing.hub_id}
          itemTypeLabel="print shop"
        />

        {/* ================================================================= */}
        {/* HONEST GATE & PAUSE STATES (NO FAKE CHECKOUT)                     */}
        {/* ================================================================= */}
        {!isPrintModuleEnabled ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="print-gate-hub-paused"
            className="rounded-2xl border border-amber-500/35 bg-[var(--ps-surface)] p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Print &amp; Digital Ordering Paused in This Hub
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                  {hubPauseMessage ||
                    'Online print ordering is currently paused for this hub. You can still contact this shop directly from its listing page.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/listing/${listing.id}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Listing</span>
              </Link>
            </div>
          </motion.div>
        ) : !hasActiveEntitlement || !profile ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="print-gate-no-entitlement"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]">
                <Printer className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Online Print Ordering Not Enabled Yet
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                  <strong>{listing.title}</strong> currently accepts standard walk-in visits, phone calls, and listing enquiries only.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/listing/${listing.id}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Listing</span>
              </Link>
              {listing.phone && (
                <a
                  href={`tel:${listing.phone}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Call Shop</span>
                </a>
              )}
            </div>
          </motion.div>
        ) : isPreLaunchPreview ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="print-gate-prelaunch-preview"
            className="rounded-2xl border border-theme-primary/35 bg-[var(--ps-surface)] p-6 space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-theme-primary/12 text-theme-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1 rounded-md border border-theme-primary/30 bg-theme-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-theme-primary">
                    Official DD oodle Print — Pre-Launch Preview
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
                    Online print ordering opening soon
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)] max-w-2xl leading-relaxed">
                    DD oodle&apos;s first-party Official Print desk is preparing for launch in your hub. Document uploads and checkout are intentionally disabled until live counter &amp; rider dispatch opens.
                  </p>
                </div>
              </div>
            </div>

            {confirmedCapabilities.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Confirmed Launch Capabilities
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {confirmedCapabilities.map((cap) => (
                    <div
                      key={cap.key}
                      className="flex items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs font-semibold text-[var(--ps-text)]"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>{cap.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-3.5 flex items-start gap-2.5 text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold text-emerald-800 dark:text-emerald-300">
                  Private Vault &amp; 48-Hour Auto-Deletion Guarantee
                </p>
                <p className="text-emerald-700/90 dark:text-emerald-300/85">
                  All uploaded PDFs are stored in an isolated private vault with masked filenames and permanently purged 48 hours after collection.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] px-4 text-xs font-bold text-[var(--ps-text-muted)] opacity-70 cursor-not-allowed"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Online print ordering opening soon</span>
              </button>
              <Link
                href={`/listing/${listing.id}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Listing</span>
              </Link>
            </div>
          </motion.div>
        ) : isTemporarilyPaused ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="print-gate-temporarily-paused"
            className="rounded-2xl border border-amber-500/35 bg-[var(--ps-surface)] p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[var(--ps-text)]">
                  Temporarily Paused
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                  <strong>{listing.title}</strong> has paused new online print uploads while clearing its current counter queue.
                  {resumeFormatted && (
                    <>
                      {' '}
                      Expected to resume around{' '}
                      <strong className="text-[var(--ps-text)]">
                        {resumeFormatted}
                      </strong>
                      .
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/listing/${listing.id}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Listing</span>
              </Link>
              {listing.phone && (
                <a
                  href={`tel:${listing.phone}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Call Counter</span>
                </a>
              )}
            </div>
          </motion.div>
        ) : (
          /* ================================================================= */
          /* LIVE ORDERING EXPERIENCE (TAB A: INSTANT PRINT, TAB B: CUSTOM)    */
          /* ================================================================= */
          <div className="space-y-4">
            {/* Sign-in Prompt if guest */}
            {!isAuthenticated && (
              <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
                  <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Sign in to upload documents securely into the private print vault and receive your 4-digit Collection OTP.
                  </span>
                </div>
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center gap-1 rounded-xl bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity shrink-0"
                >
                  <span>Sign In</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {/* Mode Switcher Tabs (Show Custom Digital ONLY when supported) */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Print order mode"
                className="inline-flex items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-1 gap-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={jobMode === 'instant_print'}
                  data-testid="print-mode-tab-instant"
                  onClick={() => setJobMode('instant_print')}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors cursor-pointer ${
                    jobMode === 'instant_print'
                      ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Instant Print</span>
                </button>

                {canCustomDigital && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={jobMode === 'custom_digital'}
                    data-testid="print-mode-tab-custom"
                    onClick={() => setJobMode('custom_digital')}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors cursor-pointer ${
                      jobMode === 'custom_digital'
                        ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Custom Digital Job</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ps-text-muted)]">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>Private vault · Auto-deleted 48h after collection</span>
              </div>
            </div>

            {/* Live Pricing Matrix Summary Strip */}
            {!instantConfirmation && !customConfirmation && profile && (
              <div
                data-testid="print-live-rate-strip"
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-[11px]"
              >
                <span className="font-bold uppercase tracking-wider text-[10px] text-[var(--ps-text-muted)] mr-1">
                  Live Rates:
                </span>
                <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)] tabular-nums">
                  B&amp;W A4: {formatInr(Number(activeRateCard.bw_a4_single_inr ?? 3))}/pg
                </span>
                {activeRateCard.bw_a4_duplex_inr !== undefined && canDuplex && (
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)] tabular-nums">
                    B&amp;W Duplex: {formatInr(Number(activeRateCard.bw_a4_duplex_inr))}/pg
                  </span>
                )}
                {canColor && (
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)] tabular-nums">
                    Color A4: {formatInr(Number(activeRateCard.color_a4_single_inr ?? 12))}/pg
                  </span>
                )}
                {canSpiralBinding && activeRateCard.spiral_binding_inr !== undefined && (
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)] tabular-nums">
                    Spiral Bind: {formatInr(Number(activeRateCard.spiral_binding_inr))}
                  </span>
                )}
                {canLamination && activeRateCard.lamination_per_sheet_inr !== undefined && (
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text)] tabular-nums">
                    Lamination: {formatInr(Number(activeRateCard.lamination_per_sheet_inr))}/sh
                  </span>
                )}
                {Number(activeRateCard.min_order_inr ?? 0) > 0 && (
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold text-[var(--ps-text-muted)] tabular-nums">
                    Min Order: {formatInr(Number(activeRateCard.min_order_inr))}
                  </span>
                )}
              </div>
            )}

            <AnimatePresence mode="wait">
              {jobMode === 'instant_print' ? (
                <motion.div
                  key="instant_print"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  {instantConfirmation ? (
                    /* ======================================================= */
                    /* INSTANT PRINT ORDER CONFIRMATION VIEW                   */
                    /* ======================================================= */
                    <div
                      data-testid="print-instant-confirmation"
                      className="rounded-2xl border border-emerald-500/35 bg-[var(--ps-surface)] p-5 sm:p-6 space-y-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-6 w-6" />
                          </div>
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                              {instantConfirmation.escrowPaid
                                ? 'Escrow Payment Submitted'
                                : 'Print Order Confirmed'}
                            </p>
                            <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
                              Order {instantConfirmation.order.order_code}
                            </h2>
                            <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                              Sent to <strong>{listing.title}</strong> · Total{' '}
                              <span className="font-bold text-[var(--ps-text)] tabular-nums">
                                {formatInr(
                                  Number(
                                    instantConfirmation.order.quoted_amount_inr || 0
                                  )
                                )}
                              </span>
                            </p>
                          </div>
                        </div>

                        <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                          {instantConfirmation.paymentRail === 'direct_counter'
                            ? 'Pay at Counter'
                            : instantConfirmation.paymentRail === 'direct_shop_upi'
                              ? 'Direct Shop UPI'
                              : 'DD oodle Escrow'}
                        </span>
                      </div>

                      {/* 4-Digit Collection OTP Box */}
                      <div className="rounded-xl border border-theme-primary/30 bg-theme-primary/8 p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme-primary text-theme-primary-foreground">
                            <KeyRound className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                              4-Digit Collection OTP
                            </p>
                            <p className="text-xs text-[var(--ps-text-muted)]">
                              Share this code at the counter when collecting your prints.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            data-testid="print-confirmation-otp"
                            className="font-mono text-2xl font-extrabold tracking-[0.25em] text-[var(--ps-text)] tabular-nums"
                          >
                            {instantConfirmation.collectionOtp}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void copyText(
                                'otp',
                                instantConfirmation.collectionOtp
                              )
                            }
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                          >
                            {copiedKey === 'otp' ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            <span>{copiedKey === 'otp' ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Direct Shop UPI QR + Copy + Launch Card */}
                      {instantConfirmation.paymentRail === 'direct_shop_upi' &&
                        instantConfirmation.shopUpi && (
                          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-center">
                            {directShopQrUrl ? (
                              <div className="mx-auto sm:mx-0 flex h-36 w-36 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 shadow-xs">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={directShopQrUrl}
                                  alt={`UPI QR code for ${instantConfirmation.shopUpi.payeeName}`}
                                  className="h-full w-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="mx-auto sm:mx-0 flex h-24 w-24 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]">
                                <QrCode className="h-8 w-8" />
                              </div>
                            )}
                            <div className="space-y-2.5 min-w-0">
                              <div>
                                <p className="text-xs font-bold text-[var(--ps-text)]">
                                  Pay Directly to {instantConfirmation.shopUpi.payeeName}
                                </p>
                                <p className="text-[11px] text-[var(--ps-text-muted)]">
                                  Scan the shop&apos;s UPI QR or copy the UPI ID below, then show confirmation at the counter.
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <code className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5 font-mono text-xs font-bold text-[var(--ps-text)]">
                                  {instantConfirmation.shopUpi.upiId}
                                </code>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(
                                      'shop-upi',
                                      instantConfirmation.shopUpi!.upiId
                                    )
                                  }
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                                >
                                  {copiedKey === 'shop-upi' ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {copiedKey === 'shop-upi' ? 'Copied' : 'Copy UPI'}
                                  </span>
                                </button>
                                <a
                                  href={instantConfirmation.shopUpi.upiUri}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground hover:opacity-95"
                                >
                                  <Smartphone className="h-3.5 w-3.5" />
                                  <span>Open UPI App</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          </div>
                        )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleResetInstantFlow}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Start Another Print Order</span>
                        </button>

                        <Link
                          href="/activity?tab=print"
                          data-testid="print-track-in-activity"
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
                        >
                          <span>Track in My Activity</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  ) : (
                    /* ======================================================= */
                    /* INSTANT PRINT WORKSPACE (2-COLUMN ON DESKTOP)           */
                    /* ======================================================= */
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
                      {/* Left Column: Upload, Per-File Config, Handover */}
                      <div className="space-y-4 min-w-0">
                        {/* 1. Upload Zone */}
                        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-theme-primary/12 text-theme-primary">
                                <FileUp className="h-4 w-4" />
                              </div>
                              <div>
                                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                                  1. Upload PDFs or Snap Photos
                                </h2>
                                <p className="text-[11px] text-[var(--ps-text-muted)]">
                                  Multiple PDFs supported · Photos auto-compress &amp; stitch into a single crisp PDF (max {profile?.max_file_size_mb || 25} MB/file)
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Hidden inputs */}
                          <input
                            ref={pdfInputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              void handleInstantFilesSelected(e.target.files);
                              e.target.value = '';
                            }}
                          />
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              void handleInstantFilesSelected(e.target.files);
                              e.target.value = '';
                            }}
                          />

                          {/* Dropzone */}
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              setIsDragOver(true);
                            }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setIsDragOver(false);
                              void handleInstantFilesSelected(e.dataTransfer.files);
                            }}
                            className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
                              isDragOver
                                ? 'border-theme-primary bg-theme-primary/8'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)]/60'
                            }`}
                          >
                            {isStitchingPhotos || isUploading ? (
                              <div className="flex flex-col items-center gap-2 py-2">
                                <Loader2 className="h-6 w-6 animate-spin text-theme-primary" />
                                <p
                                  data-testid="print-upload-status"
                                  className="text-xs font-bold text-[var(--ps-text)]"
                                >
                                  {uploadProgressText ||
                                    'Processing document...'}
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-theme-primary/10 text-theme-primary">
                                  <Upload className="h-5 w-5" />
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-xs font-bold text-[var(--ps-text)]">
                                    Drop PDFs or photos here, or pick files below
                                  </p>
                                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                                    Server verifies exact page counts · Filenames are automatically masked for privacy
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    disabled={!isAuthenticated}
                                    data-testid="print-upload-pdf-btn"
                                    onClick={() => pdfInputRef.current?.click()}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    <span>Add PDF Files</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!isAuthenticated}
                                    data-testid="print-upload-photos-btn"
                                    onClick={() => photoInputRef.current?.click()}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 transition-colors cursor-pointer"
                                  >
                                    <Camera className="h-3.5 w-3.5 text-theme-primary" />
                                    <span>Camera / Gallery → PDF</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {uploadError && (
                            <div
                              role="alert"
                              data-testid="print-upload-error"
                              className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300"
                            >
                              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                              <span>{uploadError}</span>
                            </div>
                          )}

                          {/* Uploaded Verified Files + Per-File Configurator */}
                          {instantFiles.length > 0 && (
                            <div className="space-y-3 pt-1">
                              {instantFiles.map((file, idx) => {
                                const cfg =
                                  fileConfigs[file.id] ||
                                  createDefaultFileConfig();
                                const fileQuoteLine = quoteSnapshot?.files.find(
                                  (q) => q.file_id === file.id
                                );
                                const isCustomRange =
                                  cfg.page_range.trim().toLowerCase() !== 'all' &&
                                  cfg.page_range.trim() !== '';

                                return (
                                  <div
                                    key={file.id}
                                    data-testid={`print-file-card-${idx}`}
                                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3"
                                  >
                                    {/* File Header */}
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                                          <FileCheck2 className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                          <p className="truncate text-xs font-bold text-[var(--ps-text)]">
                                            {file.display_label_masked} ·{' '}
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                              {file.server_verified_pages} page
                                              {file.server_verified_pages === 1
                                                ? ''
                                                : 's'}{' '}
                                              ✓
                                            </span>
                                          </p>
                                          <p className="text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                                            {formatBytes(file.file_size_bytes)}
                                            {fileQuoteLine && (
                                              <>
                                                {' '}
                                                · {fileQuoteLine.physical_sheets}{' '}
                                                sheet
                                                {fileQuoteLine.physical_sheets ===
                                                1
                                                  ? ''
                                                  : 's'}{' '}
                                                ·{' '}
                                                <strong className="text-[var(--ps-text)]">
                                                  {formatInr(
                                                    fileQuoteLine.line_total_inr
                                                  )}
                                                </strong>
                                              </>
                                            )}
                                          </p>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemoveLocalInstantFile(file.id)
                                        }
                                        aria-label="Remove file"
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-rose-500/10 hover:text-rose-600 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>

                                    {/* Capability-Gated Per-File Options */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-[var(--ps-border)]/60">
                                      {/* Color Mode */}
                                      <div className="space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                          Ink / Color
                                        </span>
                                        <div className="grid grid-cols-2 gap-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                color_mode: 'bw',
                                              })
                                            }
                                            className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                              cfg.color_mode === 'bw'
                                                ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                            }`}
                                          >
                                            B&amp;W
                                          </button>
                                          {canColor ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateFileConfig(file.id, {
                                                  color_mode: 'color',
                                                })
                                              }
                                              className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                                cfg.color_mode === 'color'
                                                  ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                              }`}
                                            >
                                              Color
                                            </button>
                                          ) : (
                                            <div className="h-8 rounded-lg border border-dashed border-[var(--ps-border)] flex items-center justify-center text-[10px] text-[var(--ps-text-muted)] opacity-60">
                                              B&amp;W Only
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Sides (Single vs Duplex) */}
                                      <div className="space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                          Print Sides
                                        </span>
                                        <div className="grid grid-cols-2 gap-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                duplex: false,
                                              })
                                            }
                                            className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                              !cfg.duplex
                                                ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                            }`}
                                          >
                                            Single-Sided
                                          </button>
                                          {canDuplex ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateFileConfig(file.id, {
                                                  duplex: true,
                                                })
                                              }
                                              className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                                cfg.duplex
                                                  ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                              }`}
                                            >
                                              Duplex
                                            </button>
                                          ) : (
                                            <div className="h-8 rounded-lg border border-dashed border-[var(--ps-border)] flex items-center justify-center text-[10px] text-[var(--ps-text-muted)] opacity-60">
                                              No Duplex
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Paper Size (A4 / A3) */}
                                      {canA3 && (
                                        <div className="space-y-1">
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                            Paper Size
                                          </span>
                                          <div className="grid grid-cols-2 gap-1">
                                            {(['A4', 'A3'] as const).map(
                                              (sz) => (
                                                <button
                                                  key={sz}
                                                  type="button"
                                                  onClick={() =>
                                                    updateFileConfig(file.id, {
                                                      paper_size: sz,
                                                    })
                                                  }
                                                  className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                                                    cfg.paper_size === sz
                                                      ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                      : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                                  }`}
                                                >
                                                  {sz}
                                                </button>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Copies Stepper */}
                                      <div className="space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                          Copies
                                        </span>
                                        <div className="flex h-8 items-center justify-between rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                copies: Math.max(
                                                  1,
                                                  cfg.copies - 1
                                                ),
                                              })
                                            }
                                            aria-label="Decrease copies"
                                            className="flex h-6 w-7 items-center justify-center rounded-md text-[var(--ps-text)] hover:bg-[var(--ps-bg)] cursor-pointer"
                                          >
                                            <Minus className="h-3.5 w-3.5" />
                                          </button>
                                          <span className="font-mono text-xs font-bold text-[var(--ps-text)] tabular-nums">
                                            {cfg.copies}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                copies: Math.min(
                                                  200,
                                                  cfg.copies + 1
                                                ),
                                              })
                                            }
                                            aria-label="Increase copies"
                                            className="flex h-6 w-7 items-center justify-center rounded-md text-[var(--ps-text)] hover:bg-[var(--ps-bg)] cursor-pointer"
                                          >
                                            <Plus className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>

                                      {/* Pages per Sheet */}
                                      <div className="space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                          Pages / Sheet
                                        </span>
                                        <div className="grid grid-cols-3 gap-1">
                                          {([1, 2, 4] as PagesPerSheetOption[]).map(
                                            (nup) => (
                                              <button
                                                key={nup}
                                                type="button"
                                                onClick={() =>
                                                  updateFileConfig(file.id, {
                                                    pages_per_sheet: nup,
                                                  })
                                                }
                                                className={`h-8 rounded-lg border text-xs font-bold transition-colors cursor-pointer tabular-nums ${
                                                  cfg.pages_per_sheet === nup
                                                    ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                                }`}
                                              >
                                                {nup}-up
                                              </button>
                                            )
                                          )}
                                        </div>
                                      </div>

                                      {/* Page Range */}
                                      <div className="space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                          Page Range
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                page_range: 'all',
                                              })
                                            }
                                            className={`h-8 shrink-0 rounded-lg border px-2.5 text-xs font-bold transition-colors cursor-pointer ${
                                              !isCustomRange
                                                ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                            }`}
                                          >
                                            All
                                          </button>
                                          <input
                                            type="text"
                                            value={
                                              isCustomRange ? cfg.page_range : ''
                                            }
                                            placeholder={`e.g. 1-${Math.min(20, file.server_verified_pages)}`}
                                            onChange={(e) =>
                                              updateFileConfig(file.id, {
                                                page_range:
                                                  e.target.value.trim() === ''
                                                    ? 'all'
                                                    : e.target.value,
                                              })
                                            }
                                            className="h-8 w-full min-w-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-medium text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-1 focus:ring-theme-primary"
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Finishing Toggles (strictly capability-gated) */}
                                    {(canSpiralBinding || canLamination) && (
                                      <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {canSpiralBinding && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                binding: !cfg.binding,
                                              })
                                            }
                                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors cursor-pointer ${
                                              cfg.binding
                                                ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                            }`}
                                          >
                                            <Layers className="h-3.5 w-3.5" />
                                            <span>Spiral Binding</span>
                                            {profile?.rate_card
                                              .spiral_binding_inr ? (
                                              <span className="text-[10px] opacity-80 tabular-nums">
                                                +₹
                                                {
                                                  profile.rate_card
                                                    .spiral_binding_inr
                                                }
                                              </span>
                                            ) : null}
                                          </button>
                                        )}

                                        {canLamination && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              updateFileConfig(file.id, {
                                                lamination: !cfg.lamination,
                                              })
                                            }
                                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors cursor-pointer ${
                                              cfg.lamination
                                                ? 'border-theme-primary bg-theme-primary/12 text-theme-primary'
                                                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                            }`}
                                          >
                                            <ShieldCheck className="h-3.5 w-3.5" />
                                            <span>Lamination</span>
                                            {profile?.rate_card
                                              .lamination_per_sheet_inr ? (
                                              <span className="text-[10px] opacity-80 tabular-nums">
                                                +₹
                                                {
                                                  profile.rate_card
                                                    .lamination_per_sheet_inr
                                                }
                                                /sh
                                              </span>
                                            ) : null}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        {/* 2. Handover Mode Selector */}
                        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-theme-primary/12 text-theme-primary">
                              <Package className="h-4 w-4" />
                            </div>
                            <h2 className="text-sm font-bold text-[var(--ps-text)]">
                              2. Handover &amp; Collection
                            </h2>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <button
                              type="button"
                              data-testid="handover-walk-in"
                              onClick={() => setHandoverMode('walk_in_pickup')}
                              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                                handoverMode === 'walk_in_pickup'
                                  ? 'border-theme-primary bg-theme-primary/8'
                                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                              }`}
                            >
                              <Store className="h-4 w-4 text-theme-primary shrink-0 mt-0.5" />
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-xs font-bold text-[var(--ps-text)]">
                                  Walk-In Pickup
                                </p>
                                <p className="text-[11px] text-[var(--ps-text-muted)]">
                                  Collect at the shop counter using your 4-digit OTP.
                                </p>
                              </div>
                            </button>

                            <button
                              type="button"
                              disabled={!supportsPickNDropDelivery}
                              data-testid="handover-pick-n-drop"
                              onClick={() => {
                                if (supportsPickNDropDelivery) {
                                  setHandoverMode('pick_n_drop');
                                }
                              }}
                              className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                                !supportsPickNDropDelivery
                                  ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] opacity-55 cursor-not-allowed'
                                  : handoverMode === 'pick_n_drop'
                                    ? 'border-theme-primary bg-theme-primary/8 cursor-pointer'
                                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] cursor-pointer'
                              }`}
                            >
                              <Truck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-xs font-bold text-[var(--ps-text)]">
                                  Deliver via Pick N Drop
                                </p>
                                <p className="text-[11px] text-[var(--ps-text-muted)]">
                                  {supportsPickNDropDelivery
                                    ? 'Escrow checkout + sealed rider handover once ready.'
                                    : 'Walk-in counter pickup only at this location.'}
                                </p>
                              </div>
                            </button>
                          </div>

                          {handoverMode === 'walk_in_pickup' &&
                            profile?.pickup_instructions && (
                              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 flex items-start gap-2 text-xs text-[var(--ps-text-muted)]">
                                <Info className="h-3.5 w-3.5 text-theme-primary shrink-0 mt-0.5" />
                                <span>
                                  <strong className="text-[var(--ps-text)]">
                                    Pickup note:
                                  </strong>{' '}
                                  {profile.pickup_instructions}
                                </span>
                              </div>
                            )}

                          {handoverMode === 'pick_n_drop' && (
                            <div className="space-y-2.5">
                              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2.5 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>
                                  Delivery orders use protected <strong>DD oodle Escrow</strong>. As soon as the shop marks your print ready, dispatch a verified Pick N Drop rider in 1 tap from your Activity ledger.
                                </span>
                              </div>

                              {canSealedEnvelope && (
                                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 cursor-pointer">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-[var(--ps-text)]">
                                      Sealed Privacy Envelope
                                    </p>
                                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                                      Shop seals your printed pages in an opaque envelope before rider handover
                                      {profile?.rate_card.sealed_envelope_inr
                                        ? ` (+₹${profile.rate_card.sealed_envelope_inr})`
                                        : ''}
                                    </p>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={sealedEnvelope}
                                    onChange={(e) =>
                                      setSealedEnvelope(e.target.checked)
                                    }
                                    className="h-4 w-4 rounded accent-[var(--color-primary)] cursor-pointer"
                                  />
                                </label>
                              )}
                            </div>
                          )}
                        </section>
                      </div>

                      {/* Right Column: Live Immutable Quote & Dual-Rail Payment Card */}
                      <aside className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4 lg:sticky lg:top-[128px]">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-sm font-bold text-[var(--ps-text)]">
                            Live Quote &amp; Payment
                          </h2>
                          {profile && (
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text-muted)] tabular-nums">
                              Rate v{quoteSnapshot?.pricing_version ?? profile.pricing_version}
                            </span>
                          )}
                        </div>

                        {instantFiles.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center space-y-1.5">
                            <Printer className="mx-auto h-5 w-5 text-[var(--ps-text-muted)]" />
                            <p className="text-xs font-semibold text-[var(--ps-text)]">
                              Upload a document to calculate live price
                            </p>
                            <p className="text-[11px] text-[var(--ps-text-muted)]">
                              Exact server-verified page count and shop rate card apply automatically.
                            </p>
                          </div>
                        ) : isQuoting && !quoteSnapshot ? (
                          <div className="flex items-center justify-center gap-2 py-6 text-xs font-semibold text-[var(--ps-text-muted)]">
                            <Loader2 className="h-4 w-4 animate-spin text-theme-primary" />
                            <span>Calculating server quote...</span>
                          </div>
                        ) : quoteError ? (
                          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{quoteError}</span>
                          </div>
                        ) : quoteSnapshot ? (
                          <div className="space-y-3.5">
                            {/* Itemized Breakdown */}
                            <div className="space-y-1.5 text-xs">
                              {quoteSnapshot.files.map((item) => (
                                <div
                                  key={item.file_id}
                                  className="flex items-center justify-between gap-2 text-[var(--ps-text-muted)]"
                                >
                                  <span className="truncate">
                                    {item.display_label_masked} ({item.copies}× ·{' '}
                                    {item.options.color_mode === 'color'
                                      ? 'Color'
                                      : 'B&W'}
                                    )
                                  </span>
                                  <span className="font-mono font-semibold text-[var(--ps-text)] tabular-nums shrink-0">
                                    {formatInr(item.line_total_inr)}
                                  </span>
                                </div>
                              ))}

                              {quoteSnapshot.bulk_discount_inr > 0 && (
                                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                                  <span>
                                    Bulk Discount ({quoteSnapshot.bulk_discount_percent}%)
                                  </span>
                                  <span className="font-mono font-semibold tabular-nums">
                                    -{formatInr(quoteSnapshot.bulk_discount_inr)}
                                  </span>
                                </div>
                              )}

                              {quoteSnapshot.sealed_envelope_fee_inr > 0 && (
                                <div className="flex items-center justify-between text-[var(--ps-text-muted)]">
                                  <span>Sealed Privacy Envelope</span>
                                  <span className="font-mono font-semibold text-[var(--ps-text)] tabular-nums">
                                    {formatInr(
                                      quoteSnapshot.sealed_envelope_fee_inr
                                    )}
                                  </span>
                                </div>
                              )}

                              {quoteSnapshot.min_order_adjustment_inr > 0 && (
                                <div className="flex items-center justify-between text-[var(--ps-text-muted)]">
                                  <span>Minimum Order Adjustment</span>
                                  <span className="font-mono font-semibold text-[var(--ps-text)] tabular-nums">
                                    {formatInr(
                                      quoteSnapshot.min_order_adjustment_inr
                                    )}
                                  </span>
                                </div>
                              )}

                              {quoteSnapshot.platform_fee_inr > 0 && (
                                <div className="flex items-center justify-between text-[var(--ps-text-muted)]">
                                  <span>Platform Fee</span>
                                  <span className="font-mono font-semibold text-[var(--ps-text)] tabular-nums">
                                    {formatInr(quoteSnapshot.platform_fee_inr)}
                                  </span>
                                </div>
                              )}

                              <div className="flex items-center justify-between border-t border-[var(--ps-border)] pt-2.5">
                                <div>
                                  <span className="text-xs font-bold text-[var(--ps-text)] block">
                                    Total Payable
                                  </span>
                                  <span className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                                    {quoteSnapshot.total_physical_sheets} sheets ·{' '}
                                    {quoteSnapshot.total_selected_pages} pages
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {isQuoting && (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
                                  )}
                                  <span
                                    data-testid="print-quote-total"
                                    className="font-mono text-lg font-extrabold text-[var(--ps-text)] tabular-nums"
                                  >
                                    {formatInr(quoteSnapshot.total_amount_inr)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Dual-Rail Payment Picker */}
                            <div className="space-y-2 border-t border-[var(--ps-border)] pt-3">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                Payment Method
                              </p>

                              {forcedEscrow ? (
                                <div
                                  data-testid="print-forced-escrow-notice"
                                  className="rounded-xl border border-theme-primary/35 bg-theme-primary/8 p-3 space-y-1 text-xs"
                                >
                                  <div className="flex items-center gap-1.5 font-bold text-theme-primary">
                                    <Lock className="h-3.5 w-3.5" />
                                    <span>DD oodle Escrow (Protected)</span>
                                  </div>
                                  <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
                                    {forcedEscrowReason ||
                                      'Platform Escrow is required for this order.'}
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  {allowedRails.includes('direct_counter') && (
                                    <button
                                      type="button"
                                      data-testid="rail-direct-counter"
                                      onClick={() =>
                                        setSelectedRail('direct_counter')
                                      }
                                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                        selectedRail === 'direct_counter'
                                          ? 'border-theme-primary bg-theme-primary/10 text-[var(--ps-text)] font-bold'
                                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] font-medium'
                                      }`}
                                    >
                                      <span className="flex items-center gap-2">
                                        <Store className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                                        <span>Pay at Counter</span>
                                      </span>
                                      <span className="text-[10px] opacity-80">
                                        Direct
                                      </span>
                                    </button>
                                  )}

                                  {allowedRails.includes('direct_shop_upi') &&
                                    profile?.payment_policy.shop_upi_id && (
                                      <button
                                        type="button"
                                        data-testid="rail-direct-shop-upi"
                                        onClick={() =>
                                          setSelectedRail('direct_shop_upi')
                                        }
                                        className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                          selectedRail === 'direct_shop_upi'
                                            ? 'border-theme-primary bg-theme-primary/10 text-[var(--ps-text)] font-bold'
                                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] font-medium'
                                        }`}
                                      >
                                        <span className="flex items-center gap-2">
                                          <QrCode className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                          <span>Direct Shop UPI</span>
                                        </span>
                                        <span className="text-[10px] opacity-80">
                                          Direct
                                        </span>
                                      </button>
                                    )}

                                  {allowedRails.includes('platform_escrow') && (
                                    <button
                                      type="button"
                                      data-testid="rail-platform-escrow"
                                      onClick={() =>
                                        setSelectedRail('platform_escrow')
                                      }
                                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                        selectedRail === 'platform_escrow'
                                          ? 'border-theme-primary bg-theme-primary/10 text-[var(--ps-text)] font-bold'
                                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] font-medium'
                                      }`}
                                    >
                                      <span className="flex items-center gap-2">
                                        <ShieldCheck className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                                        <span>DD oodle Escrow (Protected)</span>
                                      </span>
                                      <span className="text-[10px] opacity-80">
                                        Escrow
                                      </span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Privacy Guarantee Note */}
                            <div className="rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)]/70 px-3 py-2 flex items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span>
                                Files auto-deleted 48h after collection
                              </span>
                            </div>

                            {submitError && (
                              <div
                                role="alert"
                                className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
                              >
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{submitError}</span>
                              </div>
                            )}

                            <button
                              type="button"
                              disabled={
                                isSubmitting || isQuoting || !isAuthenticated
                              }
                              data-testid="print-submit-order-btn"
                              onClick={() => void handleSubmitInstantOrder()}
                              className="w-full h-10 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer shadow-xs"
                            >
                              {isSubmitting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Wallet className="h-4 w-4" />
                              )}
                              <span>
                                {isSubmitting
                                  ? 'Submitting Order...'
                                  : (forcedEscrow ||
                                        selectedRail === 'platform_escrow')
                                    ? `Proceed to Escrow · ${formatInr(quoteSnapshot.total_amount_inr)}`
                                    : `Confirm Print Order · ${formatInr(quoteSnapshot.total_amount_inr)}`}
                              </span>
                            </button>
                          </div>
                        ) : null}
                      </aside>
                    </div>
                  )}
                </motion.div>
              ) : (
                /* =========================================================== */
                /* TAB B: CUSTOM DIGITAL & DESIGN JOB                          */
                /* =========================================================== */
                <motion.div
                  key="custom_digital"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  {customConfirmation ? (
                    <div
                      data-testid="print-custom-confirmation"
                      className="rounded-2xl border border-emerald-500/35 bg-[var(--ps-surface)] p-6 space-y-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-6 w-6" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Order {customConfirmation.order_code}
                          </p>
                          <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
                            Quote Requested — Shop will review and send price &amp; ETA to your Activity ledger
                          </h2>
                          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                            No payment is charged yet. Once <strong>{listing.title}</strong> sends your quote, you can review the price and accept it directly from My Activity.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <Link
                          href="/activity?tab=print"
                          data-testid="custom-open-activity-btn"
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 transition-opacity"
                        >
                          <span>Open My Activity</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomConfirmation(null);
                            setCustomOrderId(null);
                            setCustomFiles([]);
                            setCustomInstructions('');
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                        >
                          <span>Request Another Quote</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => void handleSubmitCustomDigital(e)}
                      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 max-w-2xl"
                    >
                      <div className="space-y-0.5">
                        <h2 className="text-sm font-bold text-[var(--ps-text)]">
                          Request a Custom Digital or Design Quote
                        </h2>
                        <p className="text-xs text-[var(--ps-text-muted)]">
                          Describe your design, typing, form-filling, or DTP requirement. The shop will send a clear price &amp; turnaround estimate before you pay.
                        </p>
                      </div>

                      <CustomSelectModal
                        label="Service Type"
                        testId="custom-digital-service-select"
                        value={customServiceSlug}
                        onChange={setCustomServiceSlug}
                        options={CUSTOM_DIGITAL_SERVICES}
                      />

                      <div className="space-y-1.5">
                        <label
                          htmlFor="custom-digital-instructions"
                          className="block text-xs font-semibold text-[var(--ps-text)]"
                        >
                          Job Instructions &amp; Details
                        </label>
                        <textarea
                          id="custom-digital-instructions"
                          data-testid="custom-digital-instructions"
                          rows={4}
                          required
                          value={customInstructions}
                          onChange={(e) => setCustomInstructions(e.target.value)}
                          placeholder="Example: Need a 6x3 ft flex banner design for a school annual function with Hindi & English text, needed by tomorrow 4 PM..."
                          className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-theme-primary resize-y"
                        />
                      </div>

                      {/* Optional Reference Upload */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[var(--ps-text)]">
                            Reference Files (Optional)
                          </span>
                          <input
                            ref={customFileInputRef}
                            type="file"
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              void handleCustomFilesSelected(e.target.files);
                              e.target.value = '';
                            }}
                          />
                          <button
                            type="button"
                            disabled={isUploadingCustom || !isAuthenticated}
                            onClick={() => customFileInputRef.current?.click()}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                          >
                            {isUploadingCustom ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
                            ) : (
                              <FileUp className="h-3.5 w-3.5 text-theme-primary" />
                            )}
                            <span>
                              {isUploadingCustom
                                ? 'Uploading...'
                                : 'Attach PDF / Photo'}
                            </span>
                          </button>
                        </div>

                        {customUploadError && (
                          <p className="text-xs text-rose-600 dark:text-rose-400">
                            {customUploadError}
                          </p>
                        )}

                        {customFiles.length > 0 && (
                          <div className="space-y-1.5">
                            {customFiles.map((cf) => (
                              <div
                                key={cf.id}
                                className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs"
                              >
                                <span className="flex items-center gap-2 font-semibold text-[var(--ps-text)] truncate">
                                  <FileCheck2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                  <span className="truncate">
                                    {cf.display_label_masked}
                                  </span>
                                </span>
                                <span className="text-[11px] text-[var(--ps-text-muted)] tabular-nums shrink-0">
                                  {formatBytes(cf.file_size_bytes)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {customSubmitError && (
                        <div
                          role="alert"
                          className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>{customSubmitError}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <span className="text-[11px] text-[var(--ps-text-muted)]">
                          Files auto-deleted 48h after completion.
                        </span>
                        <button
                          type="submit"
                          disabled={isSubmittingCustom || !isAuthenticated}
                          data-testid="custom-submit-quote-btn"
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                        >
                          {isSubmittingCustom ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          <span>
                            {isSubmittingCustom
                              ? 'Sending Request...'
                              : 'Request Shop Quote'}
                          </span>
                        </button>
                      </div>
                    </form>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Universal Dual-Mode Payment Modal (Portaled at z-[90]+) */}
      <UniversalPaymentModal
        open={Boolean(activePaymentIntent)}
        intent={activePaymentIntent}
        upiId={escrowUpiOverride.upiId || paymentConfig.upi_id}
        upiPayeeName={
          escrowUpiOverride.payeeName || paymentConfig.upi_payee_name
        }
        title={
          handoverMode === 'pick_n_drop'
            ? 'Print Order + Pick N Drop Escrow'
            : 'Print & Digital Order Escrow'
        }
        subtitle={`${listing.title} · Protected DD oodle Escrow`}
        onSubmitted={() => {
          setActivePaymentIntent(null);
          if (pendingEscrowOrder) {
            setInstantConfirmation({
              order: pendingEscrowOrder.order,
              collectionOtp: pendingEscrowOrder.collectionOtp,
              paymentRail: 'platform_escrow',
              shopUpi: null,
              escrowPaid: true,
            });
            setPendingEscrowOrder(null);
          }
        }}
        onClose={() => {
          setActivePaymentIntent(null);
        }}
      />
    </div>
  );
}

export default PrintOrderClient;
