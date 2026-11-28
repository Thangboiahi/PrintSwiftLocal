'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Gift,
  Loader2,
  Lock,
  Megaphone,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  useAppConfig,
  useHub,
} from '@/components/providers/AppConfigProvider';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { compressImageWithPreset } from '@/lib/media/image-compressor';
import {
  clearPendingReferralCode,
  normalizeReferralCode,
  readPendingReferralCode,
} from '@/lib/referrals/pending-ref';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { PHONE_REGEX } from '@/lib/validators';

export type OnboardingTrackId = 'business_owner' | 'driver' | 'advertiser';

export interface UploadedKycDoc {
  doc_type: string;
  label: string;
  storage_path: string;
  bucket_id: string;
  uploaded_at: string;
  file_name?: string;
}

interface PartnerApplicationRow {
  id: string;
  application_code: string;
  applicant_id: string;
  hub_id: string;
  application_type: OnboardingTrackId;
  status: 'submitted' | 'under_review' | 'changes_requested' | 'approved' | 'rejected';
  full_name: string;
  phone: string;
  whatsapp_number: string | null;
  preferred_contact: 'whatsapp' | 'phone';
  locality: string | null;
  business_name: string | null;
  business_vertical: string | null;
  vehicle_type: string | null;
  vehicle_reg_no: string | null;
  license_no: string | null;
  organization_name: string | null;
  registration_fee_inr: number;
  fee_acknowledged: boolean;
  referral_code_used: string | null;
  kyc_documents: UploadedKycDoc[];
  applicant_notes: string | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface KycDocRequirement {
  docType: string;
  label: string;
  helper: string;
  required: boolean;
}

const TRACK_CONFIG: Record<
  OnboardingTrackId,
  {
    querySlug: 'business' | 'driver' | 'advertiser';
    title: string;
    shortTitle: string;
    subtitle: string;
    icon: typeof Store;
    referralType:
      | 'partner_onboarding'
      | 'driver_onboarding'
      | 'advertiser_onboarding';
    workspaceHat: string;
    kycDocs: KycDocRequirement[];
  }
> = {
  business_owner: {
    querySlug: 'business',
    title: 'Business / Shop / Venue / Hotel / Agent',
    shortTitle: 'Business Partner',
    subtitle:
      'Manage your storefront, print desk, food menu, rooms, turfs, or property listings with live customer orders.',
    icon: Store,
    referralType: 'partner_onboarding',
    workspaceHat: 'owner',
    kycDocs: [
      {
        docType: 'gov_id',
        label: 'Government ID (Aadhaar / PAN)',
        helper: 'Clear photo or PDF of owner Aadhaar or PAN card',
        required: true,
      },
      {
        docType: 'storefront_photo',
        label: 'Business / Storefront Photo',
        helper: 'Front photo of your shop, office, venue, or workspace',
        required: true,
      },
      {
        docType: 'trade_license',
        label: 'Trade License / FSSAI / Patta Proof',
        helper: 'Optional proof for faster verified badge approval',
        required: false,
      },
    ],
  },
  driver: {
    querySlug: 'driver',
    title: 'Local Driver & Rider',
    shortTitle: 'Driver / Rider',
    subtitle:
      'Join the DD oodle Pick N Drop & local ride pool with transparent fares and direct payouts.',
    icon: Truck,
    referralType: 'driver_onboarding',
    workspaceHat: 'driver',
    kycDocs: [
      {
        docType: 'gov_id',
        label: 'Government ID (Aadhaar / Voter ID)',
        helper: 'Clear front image or PDF of your government ID',
        required: true,
      },
      {
        docType: 'driving_license',
        label: 'Driving License',
        helper: 'Valid driving license matching your vehicle class',
        required: true,
      },
      {
        docType: 'vehicle_rc',
        label: 'Vehicle RC / Vehicle Photo',
        helper: 'Registration certificate or photo showing number plate',
        required: true,
      },
      {
        docType: 'driver_photo',
        label: 'Driver Photo',
        helper: 'Recent clear headshot for customer safety verification',
        required: true,
      },
    ],
  },
  advertiser: {
    querySlug: 'advertiser',
    title: 'Bulletin Advertiser / Organizer',
    shortTitle: 'Advertiser',
    subtitle:
      'Publish verified community bulletins, local job drives, events, and sponsored announcements.',
    icon: Megaphone,
    referralType: 'advertiser_onboarding',
    // v21a (P0-23): advertisers land on their own Advertiser Desk hat
    workspaceHat: 'advertiser',
    kycDocs: [
      {
        docType: 'gov_id',
        label: 'Government ID (Aadhaar / PAN)',
        helper: 'Organizer or authorized representative ID proof',
        required: true,
      },
      {
        docType: 'auth_letter',
        label: 'Authorization Letter / Org Proof',
        helper: 'Optional letterhead, society reg, or brand proof',
        required: false,
      },
    ],
  },
};

const BUSINESS_VERTICAL_OPTIONS: CustomSelectOption[] = [
  { value: 'print_digital', label: 'Print & Digital Services', description: 'Photocopy, PDF printing, banners, CSC' },
  { value: 'restaurant_food', label: 'Restaurant / Café / Bakery', description: 'Digital menu, takeaway & food delivery' },
  { value: 'shop_catalogue', label: 'Local Shop / Retail Store', description: 'Daily needs, hardware, electronics, apparel' },
  { value: 'booking_venue', label: 'Sports Turf / Event Hall / Venue', description: 'Hourly or slot-based venue bookings' },
  { value: 'hotel_stay', label: 'Hotel / Homestay / Lodge', description: 'Nightly room stays & hospitality' },
  { value: 'real_estate', label: 'Real Estate / Property Agent', description: 'Rentals, land plots & verified properties' },
  { value: 'general', label: 'General Business / Service', description: 'Clinic, studio, salon, repairs, or other' },
];

const VEHICLE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'two_wheeler', label: 'Scooty / Two-Wheeler', description: 'Fast parcels, food, and solo errands' },
  { value: 'cycle_rickshaw', label: 'Cycle Rickshaw', description: 'Eco-friendly short bazaar & lane hops' },
  { value: 'e_rickshaw', label: 'E-Rickshaw (Auto)', description: 'Local passenger rides & medium packages' },
  { value: 'mini_van', label: 'Mini-Van', description: 'Group rides, cartons & shop supplies' },
  { value: 'pickup_truck', label: 'Pickup Truck', description: 'Bulk goods, hardware & heavy loads' },
];

function resolveTrackFromQuery(raw: string | null): OnboardingTrackId {
  const norm = (raw || '').trim().toLowerCase();
  if (norm === 'driver' || norm === 'rider') return 'driver';
  if (norm === 'advertiser' || norm === 'bulletin') return 'advertiser';
  return 'business_owner';
}

function getStatusPillClasses(status: PartnerApplicationRow['status']): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'under_review':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
    case 'changes_requested':
      return 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35';
    case 'rejected':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30';
    default:
      return 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border-[var(--ps-accent)]/25';
  }
}

function formatStatusLabel(status: PartnerApplicationRow['status']): string {
  switch (status) {
    case 'submitted':
      return 'Submitted';
    case 'under_review':
      return 'Under Review';
    case 'changes_requested':
      return 'Changes Requested';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}

export interface PartnerOnboardingClientProps {
  /** Optional profile completion switcher shown when a brand-new user arrives without completing basic profile */
  showProfileSetupLink?: boolean;
  onSwitchToProfileSetup?: () => void;
}

export function PartnerOnboardingClient({
  showProfileSetupLink = false,
  onSwitchToProfileSetup,
}: PartnerOnboardingClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, session, fullName: authFullName, isLoading: authLoading } = useAuth();
  const { hubs, activeHub } = useHub();
  const { onboardingAndReferrals } = useAppConfig();
  const { setStatus } = useAppStatus();
  const { confirm: confirmSubmitDialog, dialog: confirmSubmitDialogNode } =
    useConfirmDialog();
  const isFeaturedIntent = searchParams.get('intent') === 'featured';

  // Pass V9-A: Client-memory staged files (zero Storage uploads until confirmed submission!)
  const [stagedFiles, setStagedFiles] = useState<
    Record<string, { file: File; previewUrl: string; req: KycDocRequirement }>
  >({});

  // Revoke any object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      Object.values(stagedFiles).forEach((entry) => {
        try {
          URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // ignore
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialTrack = resolveTrackFromQuery(searchParams.get('track'));
  const [selectedTrack, setSelectedTrack] = useState<OnboardingTrackId>(initialTrack);

  // Sync track if URL query changes
  useEffect(() => {
    const paramTrack = searchParams.get('track');
    if (paramTrack) {
      queueMicrotask(() => {
        setSelectedTrack(resolveTrackFromQuery(paramTrack));
      });
    }
  }, [searchParams]);

  // Existing user applications
  const [applications, setApplications] = useState<PartnerApplicationRow[]>([]);
  const [loadingApps, setLoadingApps] = useState<boolean>(true);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);

  // Form state
  const [fullName, setFullName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [whatsappNumber, setWhatsappNumber] = useState<string>('');
  const [sameAsPhone, setSameAsPhone] = useState<boolean>(true);
  const [preferredContact, setPreferredContact] = useState<'whatsapp' | 'phone'>('whatsapp');
  const [selectedHubId, setSelectedHubId] = useState<string>(activeHub?.id || '');
  const [selectedLocality, setSelectedLocality] = useState<LocalitySelection | null>(null);
  const [referralCode, setReferralCode] = useState<string>(() => readPendingReferralCode() || '');
  const [applicantNotes, setApplicantNotes] = useState<string>('');
  const [feeAcknowledged, setFeeAcknowledged] = useState<boolean>(false);

  // Track-specific state
  const [businessName, setBusinessName] = useState<string>('');
  const [businessVertical, setBusinessVertical] = useState<string>('shop_catalogue');
  const [vehicleType, setVehicleType] = useState<string>('two_wheeler');
  const [vehicleRegNo, setVehicleRegNo] = useState<string>('');
  const [licenseNo, setLicenseNo] = useState<string>('');
  const [organizationName, setOrganizationName] = useState<string>('');

  // KYC Uploads keyed by doc_type
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedKycDoc>>({});
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSuccessCode, setSubmitSuccessCode] = useState<string | null>(null);

  // Signed URL KYC Preview Modal (for applicant viewing their own uploaded docs)
  const [previewDoc, setPreviewDoc] = useState<{
    label: string;
    signedUrl: string;
    isPdf: boolean;
  } | null>(null);
  const [loadingPreviewKey, setLoadingPreviewKey] = useState<string | null>(null);

  const activeHubs = useMemo(
    () => hubs.filter((h) => h.status === 'active'),
    [hubs]
  );

  const hubOptions = useMemo<CustomSelectOption[]>(
    () =>
      activeHubs.map((h) => ({
        value: h.id,
        label: h.name,
        description: h.state || h.slug,
      })),
    [activeHubs]
  );

  const selectedHubRecord = useMemo(
    () => activeHubs.find((h) => h.id === selectedHubId) || activeHub || activeHubs[0] || null,
    [activeHubs, selectedHubId, activeHub]
  );

  useEffect(() => {
    if (!selectedHubId && selectedHubRecord?.id) {
      const nextId = selectedHubRecord.id;
      queueMicrotask(() => {
        setSelectedHubId(nextId);
      });
    }
  }, [selectedHubId, selectedHubRecord?.id]);

  // Hydrate applicant defaults & existing applications
  const userId = user?.id ?? null;

  const loadApplicantData = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setLoadingApps(false);
      return;
    }

    setLoadingApps(true);
    try {
      const [profileRes, appsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, phone, default_hub_id')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('partner_applications')
          .select('*')
          .eq('applicant_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      if (profileRes.data) {
        if (profileRes.data.full_name && !fullName) {
          setFullName(String(profileRes.data.full_name));
        }
        if (profileRes.data.phone && !phone) {
          const p = String(profileRes.data.phone);
          setPhone(p);
          if (sameAsPhone) setWhatsappNumber(p);
        }
        if (profileRes.data.default_hub_id && !selectedHubId) {
          setSelectedHubId(String(profileRes.data.default_hub_id));
        }
      } else if (authFullName && !fullName) {
        setFullName(authFullName);
      }

      if (Array.isArray(appsRes.data)) {
        setApplications(
          appsRes.data.map((row) => ({
            ...(row as PartnerApplicationRow),
            registration_fee_inr: Number(row.registration_fee_inr || 0),
            kyc_documents: Array.isArray(row.kyc_documents)
              ? (row.kyc_documents as UploadedKycDoc[])
              : [],
          }))
        );
      }
    } catch {
      // Non-fatal
    } finally {
      setLoadingApps(false);
    }
  }, [userId, authFullName, fullName, phone, sameAsPhone, selectedHubId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) {
        void loadApplicantData();
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const trackMeta = TRACK_CONFIG[selectedTrack];

  const registrationFeeInr = useMemo(() => {
    if (selectedTrack === 'driver') {
      return Number(onboardingAndReferrals?.driver_registration_fee_inr ?? 199);
    }
    if (selectedTrack === 'advertiser') {
      return Number(onboardingAndReferrals?.advertiser_registration_fee_inr ?? 499);
    }
    return Number(onboardingAndReferrals?.business_registration_fee_inr ?? 0);
  }, [selectedTrack, onboardingAndReferrals]);

  const registrationFeeNote =
    onboardingAndReferrals?.registration_fee_note?.trim() ||
    'One-time manual KYC verification & onboarding fee. Collected only after initial document review.';

  const handleTrackSwitch = (nextTrack: OnboardingTrackId) => {
    setSelectedTrack(nextTrack);
    setEditingApplicationId(null);
    setFormError(null);
    setSubmitSuccessCode(null);
    const slug = TRACK_CONFIG[nextTrack].querySlug;
    router.replace(`/onboarding?track=${slug}`, { scroll: false });
  };

  const handleLoadApplicationForEdit = (app: PartnerApplicationRow) => {
    setEditingApplicationId(app.id);
    setSelectedTrack(app.application_type);
    setFullName(app.full_name || '');
    setPhone(app.phone || '');
    const wa = app.whatsapp_number || app.phone || '';
    setWhatsappNumber(wa);
    setSameAsPhone(wa === app.phone);
    setPreferredContact(app.preferred_contact || 'whatsapp');
    if (app.hub_id) setSelectedHubId(app.hub_id);
    if (app.locality) {
      setSelectedLocality({
        id: null,
        slug: null,
        display_name: app.locality,
      });
    }
    setBusinessName(app.business_name || '');
    setBusinessVertical(app.business_vertical || 'shop_catalogue');
    const normalizedVehicle =
      app.vehicle_type === 'auto'
        ? 'e_rickshaw'
        : app.vehicle_type === 'car'
        ? 'mini_van'
        : app.vehicle_type || 'two_wheeler';
    setVehicleType(normalizedVehicle);
    setVehicleRegNo(app.vehicle_reg_no || '');
    setLicenseNo(app.license_no || '');
    setOrganizationName(app.organization_name || '');
    setReferralCode(app.referral_code_used || '');
    setApplicantNotes(app.applicant_notes || '');
    setFeeAcknowledged(Boolean(app.fee_acknowledged));

    const docsMap: Record<string, UploadedKycDoc> = {};
    for (const doc of app.kyc_documents || []) {
      if (doc.doc_type && doc.storage_path) {
        docsMap[doc.doc_type] = doc;
      }
    }
    setUploadedDocs(docsMap);
    setFormError(null);
    setSubmitSuccessCode(null);

    if (typeof window !== 'undefined') {
      const el = document.getElementById('partner-onboarding-form');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleKycFileSelect = async (
    req: KycDocRequirement,
    file: File | null
  ) => {
    if (!file) return;
    if (!user?.id) {
      setStatus('error', 'Please sign in first to upload KYC documents.');
      return;
    }

    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    if (!allowed.has(file.type.toLowerCase())) {
      setStatus('error', 'Only PDF, JPEG, PNG, or WebP files are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus('error', 'File exceeds the 10 MB maximum size limit.');
      return;
    }

    // Pass V9-A + v21b P1-04: Compress raster KYC images client-side (<=500KB WebP) and stage strictly in memory
    setFormError(null);
    let preparedFile = file;
    if (file.type.toLowerCase().startsWith('image/')) {
      try {
        const compressed = await compressImageWithPreset(file, 'kyc');
        preparedFile = compressed.file;
      } catch (err) {
        setStatus(
          'error',
          err instanceof Error ? err.message : 'Unable to process image file.'
        );
        return;
      }
    }
    const previewUrl = URL.createObjectURL(preparedFile);
    setStagedFiles((prev) => {
      const existing = prev[req.docType];
      if (existing?.previewUrl) {
        try {
          URL.revokeObjectURL(existing.previewUrl);
        } catch {
          // ignore
        }
      }
      return {
        ...prev,
        [req.docType]: { file: preparedFile, previewUrl, req },
      };
    });
    setStatus('success', `${req.label} compressed & staged (uploads only on submit)`);
  };

  const handleRemoveStagedFile = (docType: string) => {
    setStagedFiles((prev) => {
      const entry = prev[docType];
      if (entry?.previewUrl) {
        try {
          URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // ignore
        }
      }
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  };

  const handlePreviewOwnDoc = async (
    applicationId: string,
    doc: UploadedKycDoc
  ) => {
    const key = `${applicationId}:${doc.storage_path}`;
    setLoadingPreviewKey(key);
    try {
      const accessToken =
        session?.access_token ||
        (await supabase.auth.getSession()).data.session?.access_token ||
        '';

      const res = await fetch('/api/onboarding/kyc-signed-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          applicationId,
          storagePath: doc.storage_path,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        signedUrl?: string;
        label?: string;
        error?: string;
      } | null;

      if (!res.ok || !data?.signedUrl) {
        throw new Error(data?.error || 'Could not load temporary KYC preview.');
      }

      setPreviewDoc({
        label: data.label || doc.label || 'KYC Document',
        signedUrl: data.signedUrl,
        isPdf: doc.storage_path.toLowerCase().endsWith('.pdf'),
      });
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Unable to preview document.'
      );
    } finally {
      setLoadingPreviewKey(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setFormError(null);

    if (!user?.id) {
      setFormError('Please sign in first to submit a partner application.');
      return;
    }

    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();
    const cleanWhatsapp = (sameAsPhone ? cleanPhone : whatsappNumber.trim()) || cleanPhone;
    const targetHubId = selectedHubRecord?.id || '';

    if (cleanName.length < 2) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!PHONE_REGEX.test(cleanPhone)) {
      setFormError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!targetHubId) {
      setFormError('Please select an active Service Hub.');
      return;
    }

    if (selectedTrack === 'business_owner' && businessName.trim().length < 2) {
      setFormError('Please enter your Business / Shop / Venue Name.');
      return;
    }
    if (selectedTrack === 'driver' && vehicleType !== 'cycle_rickshaw') {
      if (vehicleRegNo.trim().length < 4) {
        setFormError('Please enter your Vehicle Registration Number.');
        return;
      }
      if (licenseNo.trim().length < 4) {
        setFormError('Please enter your Driving License Number.');
        return;
      }
    }
    if (selectedTrack === 'advertiser' && organizationName.trim().length < 2) {
      setFormError('Please enter your Organization or Community Name.');
      return;
    }

    // Verify all required KYC docs for this track are either staged in memory or already uploaded (when editing)
    const missingRequired = trackMeta.kycDocs.filter(
      (req) =>
        req.required &&
        !stagedFiles[req.docType]?.file &&
        !uploadedDocs[req.docType]?.storage_path
    );
    if (missingRequired.length > 0) {
      setFormError(
        `Please attach all required KYC documents: ${missingRequired
          .map((d) => d.label)
          .join(', ')}.`
      );
      return;
    }

    if (!feeAcknowledged) {
      setFormError(
        'Please acknowledge the manual verification process and registration fee terms.'
      );
      return;
    }

    // Pass V9-A: Require explicit confirmation BEFORE uploading files to Storage or writing DB rows
    const stagedCount = Object.keys(stagedFiles).length;
    const confirmed = await confirmSubmitDialog({
      title: editingApplicationId
        ? 'Update & Resubmit Partner Application?'
        : `Submit ${trackMeta.title} Application?`,
      description:
        stagedCount > 0
          ? `${stagedCount} private verification document(s) will be uploaded securely and your application will be routed to the ${selectedHubRecord?.name || 'local'} hub team for review.`
          : `Your application will be submitted to the ${selectedHubRecord?.name || 'local'} hub team for review.`,
      confirmLabel: editingApplicationId
        ? 'Confirm & Resubmit'
        : 'Confirm & Submit Application',
      cancelLabel: 'Review Form',
      variant: 'default',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    setStatus('saving', 'Uploading private documents & submitting...');

    try {
      const accessToken =
        session?.access_token ||
        (await supabase.auth.getSession()).data.session?.access_token ||
        '';

      // Upload staged files now (only after explicit confirmation!)
      const mergedDocs: Record<string, UploadedKycDoc> = { ...uploadedDocs };
      for (const req of trackMeta.kycDocs) {
        const staged = stagedFiles[req.docType];
        if (!staged?.file) continue;
        setUploadingDocType(req.docType);
        const formData = new FormData();
        formData.append('file', staged.file);
        formData.append('entityType', 'kyc_document');
        if (editingApplicationId) {
          formData.append('entityId', editingApplicationId);
        }
        if (selectedHubRecord?.id) {
          formData.append('hubId', selectedHubRecord.id);
        }
        const uploadRes = await fetch('/api/media/upload', {
          method: 'POST',
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : undefined,
          body: formData,
        });
        const uploadPayload = (await uploadRes.json().catch(() => null)) as {
          success?: boolean;
          path?: string;
          bucketId?: string;
          error?: string;
        } | null;
        if (!uploadRes.ok || !uploadPayload?.success || !uploadPayload.path) {
          throw new Error(
            uploadPayload?.error || `Failed to upload ${req.label}.`
          );
        }
        mergedDocs[req.docType] = {
          doc_type: req.docType,
          label: req.label,
          storage_path: uploadPayload.path,
          bucket_id: uploadPayload.bucketId || 'kyc-documents',
          uploaded_at: new Date().toISOString(),
          file_name: staged.file.name,
        };
      }
      setUploadingDocType(null);
      setUploadedDocs(mergedDocs);

      const docsArray: UploadedKycDoc[] = trackMeta.kycDocs
        .map((req) => mergedDocs[req.docType])
        .filter((d): d is UploadedKycDoc => Boolean(d && d.storage_path))
        .map((d) => ({
          doc_type: d.doc_type,
          label: d.label,
          storage_path: d.storage_path,
          bucket_id: d.bucket_id || 'kyc-documents',
          uploaded_at: d.uploaded_at || new Date().toISOString(),
        }));

      const normalizedRef = normalizeReferralCode(referralCode);

      const payload = {
        applicant_id: user.id,
        hub_id: targetHubId,
        application_type: selectedTrack,
        full_name: cleanName,
        phone: cleanPhone,
        whatsapp_number: cleanWhatsapp,
        preferred_contact: preferredContact,
        locality: selectedLocality?.display_name?.trim() || null,
        business_name:
          selectedTrack === 'business_owner' ? businessName.trim() : null,
        business_vertical:
          selectedTrack === 'business_owner' ? businessVertical : null,
        vehicle_type: selectedTrack === 'driver' ? vehicleType : null,
        vehicle_reg_no:
          selectedTrack === 'driver'
            ? vehicleRegNo.trim().toUpperCase() || null
            : null,
        license_no:
          selectedTrack === 'driver'
            ? licenseNo.trim().toUpperCase() || null
            : null,
        organization_name:
          selectedTrack === 'advertiser' ? organizationName.trim() : null,
        registration_fee_inr: registrationFeeInr,
        fee_acknowledged: true,
        referral_code_used: normalizedRef || null,
        kyc_documents: docsArray,
        applicant_notes: applicantNotes.trim() || null,
      };

      // Clear client-memory staged previews after upload succeeds
      Object.values(stagedFiles).forEach((entry) => {
        try {
          URL.revokeObjectURL(entry.previewUrl);
        } catch {
          // ignore
        }
      });
      setStagedFiles({});

      let savedCode = '';

      if (editingApplicationId) {
        const { data, error } = await supabase
          .from('partner_applications')
          .update(payload)
          .eq('id', editingApplicationId)
          .select('id, application_code')
          .single();

        if (error) throw error;
        savedCode = String(data?.application_code || '');
      } else {
        const { data, error } = await supabase
          .from('partner_applications')
          .insert(payload)
          .select('id, application_code')
          .single();

        if (error) throw error;
        savedCode = String(data?.application_code || '');
      }

      // Record referral attribution non-blockingly if a referral code was provided
      if (normalizedRef) {
        try {
          await supabase.rpc('apply_referral_code', {
            p_code: normalizedRef,
            p_referral_type: trackMeta.referralType,
            p_hub_id: targetHubId,
          });
          clearPendingReferralCode();
        } catch {
          // Non-fatal; review RPC also qualifies linked referral on approval
        }
      }

      setSubmitSuccessCode(savedCode || 'SUBMITTED');
      setEditingApplicationId(null);
      setApplicantNotes('');
      setUploadedDocs({});
      setFeeAcknowledged(false);
      setStatus(
        'success',
        `Application ${savedCode} submitted! Our ${selectedHubRecord?.name || 'local'} team will contact you shortly.`
      );
      await loadApplicantData();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to submit partner application.';
      setFormError(msg);
      setStatus('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--ps-accent)]" />
      </div>
    );
  }

  return (
    <div
      data-testid="partner-onboarding-page"
      className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-6 min-w-0 overflow-x-clip"
    >
      {/* Header Banner */}
      <header className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <DDoodleLogo variant="mark" size={32} />
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ps-accent)]/12 px-2.5 py-0.5 text-[11px] font-bold text-[var(--ps-accent)]">
              <Sparkles className="h-3 w-3" />
              <span>Partner &amp; Driver Onboarding</span>
            </span>
          </div>
          {showProfileSetupLink && onSwitchToProfileSetup && (
            <button
              type="button"
              onClick={onSwitchToProfileSetup}
              className="text-xs font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
            >
              Finish Basic Profile Setup →
            </button>
          )}
        </div>

        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--ps-text)]">
            Join DD oodle as a Verified Local Partner
          </h1>
          <p className="text-xs sm:text-sm text-[var(--ps-text-muted)] leading-relaxed">
            Submit your KYC documents securely below. Every application is manually reviewed by our local Hub Manager or Admin team before workspace activation.
          </p>
        </div>
      </header>

      {/* Pass V9-A: Optional ?intent=featured banner */}
      {isFeaturedIntent && (
        <div
          data-testid="onboarding-featured-intent-banner"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 flex items-start gap-3 text-xs"
        >
          <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-bold text-[var(--ps-text)]">
              Want to feature your business on the {activeHub?.name || 'Local'} Homepage?
            </div>
            <p className="text-[var(--ps-text-muted)]">
              Complete your verified Business Partner application below. Once approved, you can request Homepage Featured Placements directly from the homepage or your Owner Workspace.
            </p>
          </div>
        </div>
      )}

      {/* Sign-in Prompt for Guests */}
      {!user && (
        <section
          data-testid="onboarding-guest-gate"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/8 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Lock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Sign in to submit your KYC application
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                You need a DD oodle account so our team can bind your private KYC documents, track application status, and activate your workspace hat upon approval.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/login?next=${encodeURIComponent(`/onboarding?track=${trackMeta.querySlug}`)}`}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95"
            >
              <span>Sign In</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(`/onboarding?track=${trackMeta.querySlug}`)}`}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              Create Account
            </Link>
          </div>
        </section>
      )}

      {/* My Applications Status Tracker */}
      {user && (loadingApps || applications.length > 0) && (
        <section
          data-testid="my-applications-tracker"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-xs space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-[var(--ps-accent)]" />
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                My Partner Applications ({applications.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void loadApplicantData()}
              disabled={loadingApps}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
            >
              <RefreshCw
                className={`h-3 w-3 ${loadingApps ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
          </div>

          {loadingApps ? (
            <div className="flex items-center gap-2 text-xs text-[var(--ps-text-muted)] py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading your applications…</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {applications.map((app) => {
                const meta = TRACK_CONFIG[app.application_type] || TRACK_CONFIG.business_owner;
                const TrackIcon = meta.icon;
                const hubName =
                  hubs.find((h) => h.id === app.hub_id)?.name || 'Local Hub';
                const canEdit =
                  app.status === 'changes_requested' || app.status === 'submitted';

                return (
                  <div
                    key={app.id}
                    data-testid={`my-application-card-${app.application_code}`}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]">
                          <TrackIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-extrabold text-[var(--ps-text)] font-mono">
                              {app.application_code}
                            </span>
                            <span className="rounded-md bg-[var(--ps-surface)] border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                              {meta.shortTitle}
                            </span>
                            <span className="text-[11px] text-[var(--ps-text-muted)]">
                              · {hubName}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-[var(--ps-text)] mt-0.5 truncate">
                            {app.business_name ||
                              app.organization_name ||
                              (app.vehicle_reg_no
                                ? `${app.full_name} · ${app.vehicle_reg_no}`
                                : app.full_name)}
                          </div>
                          <div className="text-[10.5px] text-[var(--ps-text-muted)] mt-0.5">
                            Submitted{' '}
                            {new Date(app.created_at).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              timeZone: 'Asia/Kolkata',
                            })}{' '}
                            · Callback via{' '}
                            <strong className="text-[var(--ps-text)] capitalize">
                              {app.preferred_contact}
                            </strong>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold shrink-0 ${getStatusPillClasses(
                          app.status
                        )}`}
                      >
                        {app.status === 'approved' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : app.status === 'rejected' ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        <span>{formatStatusLabel(app.status)}</span>
                      </span>
                    </div>

                    {app.reviewer_notes && (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11px] text-[var(--ps-text)]">
                        <span className="font-bold text-amber-800 dark:text-amber-300">
                          Reviewer Feedback:{' '}
                        </span>
                        <span className="break-words">{app.reviewer_notes}</span>
                      </div>
                    )}

                    {/* Attached private KYC quick preview chips */}
                    {app.kyc_documents.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {app.kyc_documents.map((doc) => {
                          const pKey = `${app.id}:${doc.storage_path}`;
                          return (
                            <button
                              key={doc.storage_path}
                              type="button"
                              disabled={loadingPreviewKey === pKey}
                              onClick={() => void handlePreviewOwnDoc(app.id, doc)}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[10.5px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                            >
                              {loadingPreviewKey === pKey ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Eye className="h-3 w-3 text-[var(--ps-accent)]" />
                              )}
                              <span className="max-w-[160px] truncate">
                                {doc.label || doc.doc_type}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleLoadApplicationForEdit(app)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/12 px-3 text-xs font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>
                            {app.status === 'changes_requested'
                              ? 'Re-upload Docs & Resubmit'
                              : 'Update Application'}
                          </span>
                        </button>
                      )}
                      {app.status === 'approved' && (
                        <Link
                          href={`/workspace/${meta.workspaceHat}`}
                          data-testid={`open-approved-workspace-${app.application_code}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 text-xs font-bold text-white shadow-xs"
                        >
                          <span>Open My Workspace</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Track Selector Cards */}
      <section className="space-y-2.5" aria-label="Select onboarding track">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            1. Choose Your Partner Track
          </h2>
          {editingApplicationId && (
            <button
              type="button"
              onClick={() => {
                setEditingApplicationId(null);
                setUploadedDocs({});
              }}
              className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer"
            >
              Cancel Editing Application
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            ['business_owner', 'driver', 'advertiser'] as OnboardingTrackId[]
          ).map((trackId) => {
            const cfg = TRACK_CONFIG[trackId];
            const Icon = cfg.icon;
            const active = selectedTrack === trackId;
            const fee =
              trackId === 'driver'
                ? Number(onboardingAndReferrals?.driver_registration_fee_inr ?? 199)
                : trackId === 'advertiser'
                  ? Number(
                      onboardingAndReferrals?.advertiser_registration_fee_inr ?? 499
                    )
                  : Number(
                      onboardingAndReferrals?.business_registration_fee_inr ?? 0
                    );

            return (
              <button
                key={trackId}
                type="button"
                data-testid={`onboarding-track-card-${cfg.querySlug}`}
                aria-pressed={active}
                onClick={() => handleTrackSwitch(trackId)}
                className={`text-left rounded-2xl border p-4 transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  active
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/8 ring-2 ring-[var(--ps-accent)]/25 shadow-xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)]/40'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                        active
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
                        fee > 0
                          ? 'bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]'
                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {fee > 0 ? `₹${fee} Reg. Fee` : 'Free Waiver'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-[var(--ps-text)] leading-snug">
                    {cfg.title}
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-[var(--ps-text-muted)]">
                    {cfg.subtitle}
                  </p>
                </div>
                <div className="text-[11px] font-bold text-[var(--ps-accent)] flex items-center gap-1">
                  <span>{active ? 'Selected Track' : 'Select Track'}</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Transparent Registration Charge & Manual Verification Banner */}
      <section
        data-testid="onboarding-fee-disclosure-banner"
        className="rounded-2xl border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/6 p-4 sm:p-5 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <h3 className="text-xs sm:text-sm font-bold text-[var(--ps-text)]">
              Transparent Registration Fee &amp; Manual Verification
            </h3>
          </div>
          <span className="rounded-full bg-[var(--ps-accent)] px-3 py-0.5 text-[11px] font-extrabold text-[var(--ps-accent-fg)]">
            {registrationFeeInr > 0
              ? `₹${registrationFeeInr} One-Time Fee`
              : 'Free / Introductory Waiver'}
          </span>
        </div>
        <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
          <strong className="text-[var(--ps-text)]">Manual Verification:</strong>{' '}
          Our local{' '}
          <strong className="text-[var(--ps-text)]">
            {selectedHubRecord?.name || 'Service'}
          </strong>{' '}
          Hub Manager or Admin team will verify your documents and contact you
          back via your preferred channel before activating your workspace.
        </p>
        <p className="text-[11px] text-[var(--ps-text-muted)]">
          {registrationFeeNote}
        </p>
      </section>

      {/* Main Application Form */}
      <form
        id="partner-onboarding-form"
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 shadow-xs space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-[var(--ps-text)]">
              {editingApplicationId
                ? `Update ${trackMeta.shortTitle} Application`
                : `2. ${trackMeta.shortTitle} Application Details`}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              All KYC files are stored strictly in private storage and auto-purged 30 days after review.
            </p>
          </div>
        </div>

        {submitSuccessCode && (
          <div
            data-testid="onboarding-submit-success"
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 flex items-start gap-3 text-xs"
          >
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-emerald-800 dark:text-emerald-300">
                Application {submitSuccessCode} Submitted Successfully!
              </div>
              <p className="text-[var(--ps-text-muted)]">
                Our local {selectedHubRecord?.name || 'hub'} team will review your KYC documents and contact you back via{' '}
                <strong className="text-[var(--ps-text)] capitalize">
                  {preferredContact}
                </strong>
                . You can track live review status above anytime.
              </p>
            </div>
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        {/* Section A: Common Contact & Hub Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-full-name"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="onboarding-full-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Thangboi Haokip"
              className="h-10 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>

          <div className="space-y-1.5">
            <PhoneInputWithCountry
              id="onboarding-phone"
              label="Phone Number"
              required
              value={phone}
              onChange={(next) => {
                setPhone(next);
                if (sameAsPhone) setWhatsappNumber(next);
              }}
              testId="onboarding-phone-input"
            />
          </div>

          <div className="space-y-1.5">
            <PhoneInputWithCountry
              id="onboarding-whatsapp"
              label="WhatsApp Number"
              value={sameAsPhone ? phone : whatsappNumber}
              onChange={(next) => setWhatsappNumber(next)}
              sameAsPhoneChecked={sameAsPhone}
              onSameAsPhoneChange={(checked) => {
                setSameAsPhone(checked);
                if (checked) setWhatsappNumber(phone);
              }}
              sourcePhoneValue={phone}
              testId="onboarding-whatsapp-input"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-[var(--ps-text)]">
              Preferred Callback Method <span className="text-rose-500">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreferredContact('whatsapp')}
                aria-pressed={preferredContact === 'whatsapp'}
                className={`h-10 rounded-xl border px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  preferredContact === 'whatsapp'
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() => setPreferredContact('phone')}
                aria-pressed={preferredContact === 'phone'}
                className={`h-10 rounded-xl border px-3 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  preferredContact === 'phone'
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Phone className="h-3.5 w-3.5" />
                <span>Phone Call</span>
              </button>
            </div>
          </div>

          <div>
            <CustomSelectModal
              id="onboarding-hub-select"
              testId="onboarding-hub-select"
              label="Service Hub *"
              options={hubOptions}
              value={selectedHubId}
              onChange={(val) => {
                setSelectedHubId(val);
                setSelectedLocality(null);
              }}
              placeholder="Select Service Hub"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--ps-text)]">
              Locality / Area
            </label>
            <LocalityCombobox
              id="partner-onboarding-locality"
              hubId={selectedHubRecord?.id || null}
              value={
                selectedLocality
                  ? {
                      id: selectedLocality.id,
                      display_name: selectedLocality.display_name,
                    }
                  : null
              }
              onSelect={(loc) => setSelectedLocality(loc)}
              onClear={() => setSelectedLocality(null)}
              allowCreate={true}
              placeholder={`Search locality in ${selectedHubRecord?.name || 'your hub'}…`}
            />
          </div>
        </div>

        {/* Section B: Dynamic Track-Specific Fields */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/60 p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--ps-text)]">
            <Building2 className="h-4 w-4 text-[var(--ps-accent)]" />
            <span>{trackMeta.shortTitle} Information</span>
          </div>

          {selectedTrack === 'business_owner' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="onboarding-business-name"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Business / Shop / Venue Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="onboarding-business-name"
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Lamka Digital Prints & Studio"
                  className="h-10 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>
              <div>
                <CustomSelectModal
                  id="onboarding-business-vertical"
                  testId="onboarding-business-vertical"
                  label="Business Vertical *"
                  options={BUSINESS_VERTICAL_OPTIONS}
                  value={businessVertical}
                  onChange={setBusinessVertical}
                  placeholder="Select Business Category"
                />
              </div>
            </div>
          )}

          {selectedTrack === 'driver' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <CustomSelectModal
                  id="onboarding-vehicle-type"
                  testId="onboarding-vehicle-type"
                  label="Vehicle Type *"
                  options={VEHICLE_TYPE_OPTIONS}
                  value={vehicleType}
                  onChange={setVehicleType}
                  placeholder="Select Vehicle Class"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="onboarding-vehicle-reg"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Vehicle Registration Number{' '}
                  {vehicleType === 'cycle_rickshaw' ? (
                    <span className="text-[11px] font-normal text-[var(--ps-text-muted)]">
                      (Optional)
                    </span>
                  ) : (
                    <span className="text-rose-500">*</span>
                  )}
                </label>
                <input
                  id="onboarding-vehicle-reg"
                  type="text"
                  required={vehicleType !== 'cycle_rickshaw'}
                  value={vehicleRegNo}
                  onChange={(e) => setVehicleRegNo(e.target.value.toUpperCase())}
                  placeholder={
                    vehicleType === 'cycle_rickshaw'
                      ? 'Optional stand / plate code'
                      : 'e.g. MN02A1234'
                  }
                  className="h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-mono uppercase text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="onboarding-license-no"
                  className="block text-xs font-semibold text-[var(--ps-text)]"
                >
                  Driving License Number{' '}
                  {vehicleType === 'cycle_rickshaw' ? (
                    <span className="text-[11px] font-normal text-[var(--ps-text-muted)]">
                      (Optional)
                    </span>
                  ) : (
                    <span className="text-rose-500">*</span>
                  )}
                </label>
                <input
                  id="onboarding-license-no"
                  type="text"
                  required={vehicleType !== 'cycle_rickshaw'}
                  value={licenseNo}
                  onChange={(e) => setLicenseNo(e.target.value.toUpperCase())}
                  placeholder="e.g. MN0220210004512"
                  className="h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-mono uppercase text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
              </div>
            </div>
          )}

          {selectedTrack === 'advertiser' && (
            <div className="space-y-1.5">
              <label
                htmlFor="onboarding-org-name"
                className="block text-xs font-semibold text-[var(--ps-text)]"
              >
                Organization / Community / Brand Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="onboarding-org-name"
                type="text"
                required
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="e.g. Churachandpur Youth Sports Committee"
                className="h-10 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
            </div>
          )}
        </div>

        {/* Section C: Private KYC Document Uploads */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[var(--ps-accent)]" />
              <h3 className="text-xs sm:text-sm font-bold text-[var(--ps-text)]">
                Private KYC Document Uploads
              </h3>
            </div>
            <span className="text-[11px] text-[var(--ps-text-muted)]">
              PDF, JPG, PNG, WebP · Max 10 MB each
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trackMeta.kycDocs.map((req) => {
              const staged = stagedFiles[req.docType];
              const uploaded = uploadedDocs[req.docType];
              const hasDoc = Boolean(staged || uploaded);
              const isUploading = uploadingDocType === req.docType;

              return (
                <div
                  key={req.docType}
                  data-testid={`kyc-upload-slot-${req.docType}`}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                    hasDoc
                      ? 'border-emerald-500/40 bg-emerald-500/6'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                        <span>{req.label}</span>
                        {req.required ? (
                          <span className="text-[10px] font-extrabold text-rose-500">
                            Required
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                            Optional
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--ps-text-muted)] mt-0.5">
                        {req.helper}
                      </p>
                    </div>
                    {hasDoc && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                  </div>

                  {hasDoc ? (
                    <div className="space-y-1.5">
                      {staged && staged.file.type.startsWith('image/') && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={staged.previewUrl}
                          alt={req.label}
                          className="h-20 w-full rounded-lg object-cover border border-[var(--ps-border)]"
                        />
                      )}
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-[var(--ps-surface)] px-2.5 py-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 min-w-0 text-emerald-700 dark:text-emerald-300 font-semibold">
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {staged
                              ? `${staged.file.name} (ready)`
                              : uploaded?.file_name || 'Uploaded privately'}
                          </span>
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {staged && (
                            <button
                              type="button"
                              onClick={() => handleRemoveStagedFile(req.docType)}
                              className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          )}
                          <label className="text-[11px] font-bold text-[var(--ps-accent)] hover:underline cursor-pointer">
                            <span>Replace</span>
                            <input
                              type="file"
                              accept=".pdf,image/jpeg,image/png,image/webp"
                              className="sr-only"
                              disabled={!user || isUploading}
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                e.target.value = '';
                                void handleKycFileSelect(req, f);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label
                      className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors ${
                        !user || isUploading
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer'
                      }`}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Uploading securely…</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" />
                          <span>Upload Private File</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept=".pdf,image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={!user || isUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          e.target.value = '';
                          void handleKycFileSelect(req, f);
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Section D: Referral Code & Additional Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-referral-code"
              className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ps-text)]"
            >
              <Gift className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Referral Code (Optional)</span>
            </label>
            <input
              id="onboarding-referral-code"
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder="e.g. DD-A1B2C3"
              className="h-10 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-mono uppercase text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-notes"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Notes / Best Callback Time (Optional)
            </label>
            <input
              id="onboarding-notes"
              type="text"
              value={applicantNotes}
              onChange={(e) => setApplicantNotes(e.target.value)}
              placeholder="e.g. Please call after 2 PM, shop near Tuibong"
              className="h-10 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </div>

        {/* Acknowledgement & Submit */}
        <div className="space-y-4 pt-2 border-t border-[var(--ps-border)]">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="onboarding-fee-ack-checkbox"
              checked={feeAcknowledged}
              onChange={(e) => setFeeAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-[var(--ps-accent)] shrink-0"
            />
            <span className="text-xs text-[var(--ps-text)] leading-relaxed">
              I acknowledge the manual verification process and applicable
              registration fee terms (
              <strong>
                {registrationFeeInr > 0
                  ? `₹${registrationFeeInr} one-time fee after initial review`
                  : 'Free / Introductory Waiver'}
              </strong>
              ).
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/"
              className="text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              ← Return Home
            </Link>
            <button
              type="submit"
              disabled={!user || isSubmitting || uploadingDocType !== null}
              data-testid="onboarding-submit-btn"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-6 text-xs font-bold text-[var(--ps-accent-fg)] shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Submitting Application…</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>
                    {editingApplicationId
                      ? 'Resubmit Updated Application'
                      : 'Submit for Manual Verification'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Temporary Signed KYC Preview Modal (z-[90]) */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label={previewDoc.label}
        >
          <div className="relative w-full max-w-2xl max-h-[85dvh] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--ps-text)] truncate">
                  {previewDoc.label}
                </div>
                <div className="text-[10.5px] text-[var(--ps-text-muted)]">
                  Temporary private preview link (expires in 120 seconds)
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={previewDoc.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  aria-label="Close document preview"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[var(--ps-bg)] flex items-center justify-center min-h-[280px]">
              {previewDoc.isPdf ? (
                <iframe
                  src={previewDoc.signedUrl}
                  title={previewDoc.label}
                  className="w-full h-[60dvh] rounded-xl border border-[var(--ps-border)] bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewDoc.signedUrl}
                  alt={previewDoc.label}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[65dvh] rounded-xl object-contain border border-[var(--ps-border)]"
                />
              )}
            </div>
          </div>
        </div>
      )}
      {confirmSubmitDialogNode}
    </div>
  );
}

export default PartnerOnboardingClient;
