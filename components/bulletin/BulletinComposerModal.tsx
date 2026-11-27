'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  ImagePlus,
  Link2,
  MapPin,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  YouTubeEmbedPlayer,
  isValidYouTubeVideoId,
  sanitizeBulletinHref,
  type TiptapDoc,
  type TiptapNode,
} from '@/components/bulletin/BulletinContentRenderer';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import {
  PhoneInput,
  isValidCountryPhone,
  normalizePhoneToE164,
} from '@/components/ui/PhoneInput';
import { CHURACHANDPUR_FALLBACK_CENTER } from '@/lib/maps/coordinates';
import { compressImageWithPreset } from '@/lib/media/image-compressor';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { LatLngPoint } from '@/lib/types';

export type BulletinCategoryValue =
  | 'announcement'
  | 'job'
  | 'event'
  | 'ad'
  | 'notice';

export interface EditableBulletinRecord {
  id: string;
  title: string;
  category: BulletinCategoryValue | string;
  content_json?: TiptapDoc | string | null;
  content_plain?: string | null;
  image_urls?: string[] | null;
  youtube_video_id?: string | null;
  contact_channels?: {
    phone?: string;
    whatsapp?: string;
    email?: string;
    website?: string;
    venue?: {
      label?: string;
      lat?: number;
      lng?: number;
    };
  } | null;
  linked_listing_id?: string | null;
  expires_at?: string | null;
  paid_until?: string | null;
  status?: string;
  venue_label?: string | null;
  venue_lat?: number | null;
  venue_lng?: number | null;
}

export interface BulletinComposerModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  onPublished?: () => void;
  initialMode?: 'compose' | 'plans';
  editingBulletin?: EditableBulletinRecord | null;
}

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  title?: string | null;
  tagline: string | null;
  info?: string | null;
  price_inr: number;
  max_active_bulletins: number;
  max_monthly_posts: number;
  max_images_per_post: number;
  allow_youtube: boolean;
  duration_days: number;
  trial_days?: number;
  is_default_free?: boolean;
  is_archived?: boolean;
  target_scope?: string;
  entitlements?: Record<string, unknown> | null;
  display_order: number;
}

interface ActiveSubscriptionSummary {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_slug: string;
  status: string;
  is_trial: boolean;
  max_active_bulletins: number | null;
  max_monthly_posts: number | null;
  max_images_per_post: number;
  allow_youtube: boolean;
  auto_verify_bulletins: boolean;
  ends_at: string | null;
}

interface OwnerListingOption {
  id: string;
  title: string;
  category: string | null;
}

interface PayPerPostMeta {
  id: string;
  title: string;
  hasYouTube?: boolean;
}

export const BULLETIN_CATEGORY_OPTIONS: Array<{
  value: BulletinCategoryValue;
  label: string;
  description: string;
}> = [
  {
    value: 'announcement',
    label: 'Announcement',
    description: 'Community updates, town notices & public info',
  },
  {
    value: 'job',
    label: 'Job Post',
    description: 'Local hiring, vacancies & internship openings',
  },
  {
    value: 'event',
    label: 'Event',
    description: 'Festivals, sports meets, workshops & gatherings',
  },
  {
    value: 'ad',
    label: 'Advertisement',
    description: 'Shop promotions, seasonal offers & launches',
  },
  {
    value: 'notice',
    label: 'Notice',
    description: 'Official circulars, schedules & alerts',
  },
];

/**
 * Strictly parses a YouTube URL or 11-character video ID.
 * Returns { videoId, error } — rejects non-YouTube domains/URLs cleanly.
 */
export function parseStrictYouTubeInput(rawInput: string): {
  videoId: string | null;
  error: string | null;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { videoId: null, error: null };
  }

  // Raw 11-char ID allowed only if it doesn't contain slashes/dots/spaces
  if (isValidYouTubeVideoId(trimmed)) {
    return { videoId: trimmed, error: null };
  }

  let parsedUrl: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    parsedUrl = new URL(withProtocol);
  } catch {
    return {
      videoId: null,
      error:
        'Enter a valid YouTube URL (youtube.com/watch?v=..., youtu.be/..., or youtube.com/shorts/...).',
    };
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  const allowedHosts = new Set([
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
  ]);

  if (!allowedHosts.has(host)) {
    return {
      videoId: null,
      error:
        'Only official YouTube links (youtube.com or youtu.be) are allowed for embedded video notices.',
    };
  }

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] || null;
  } else {
    const vParam = parsedUrl.searchParams.get('v');
    if (vParam) {
      candidate = vParam;
    } else {
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        ['embed', 'shorts', 'live', 'v'].includes(segments[0].toLowerCase())
      ) {
        candidate = segments[1];
      }
    }
  }

  if (!candidate || !isValidYouTubeVideoId(candidate)) {
    return {
      videoId: null,
      error:
        'Could not extract a valid 11-character YouTube video ID from this link.',
    };
  }

  return { videoId: candidate, error: null };
}

function buildTiptapDocFromPlainText(plain: string): TiptapDoc {
  const blocks = plain
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const content: TiptapNode[] = blocks.map((block) => {
    const lines = block.split('\n');
    const children: TiptapNode[] = [];
    lines.forEach((line, idx) => {
      if (line.length > 0) {
        children.push({ type: 'text', text: line });
      }
      if (idx < lines.length - 1) {
        children.push({ type: 'hardBreak' });
      }
    });
    return {
      type: 'paragraph',
      content: children.length > 0 ? children : [{ type: 'text', text: block }],
    };
  });

  return {
    type: 'doc',
    content:
      content.length > 0
        ? content
        : [{ type: 'paragraph', content: [{ type: 'text', text: plain.trim() }] }],
  };
}

function extractPlainTextFromContent(
  doc: TiptapDoc | string | null | undefined,
  fallbackPlain?: string | null
): string {
  if (fallbackPlain && fallbackPlain.trim()) return fallbackPlain.trim();
  if (!doc) return '';
  if (typeof doc === 'string') return doc.trim();

  const parts: string[] = [];
  const walk = (node: TiptapNode) => {
    if (node.type === 'text' && node.text) {
      parts.push(node.text);
    } else if (node.type === 'hardBreak') {
      parts.push('\n');
    } else if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
        parts.push('\n\n');
      }
    }
  };
  walk(doc);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

async function compressImageToWebp(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else resolve(file);
        },
        'image/webp',
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not process image file.'));
    };
    img.src = objectUrl;
  });
}

const VALID_CATEGORIES = new Set<BulletinCategoryValue>([
  'announcement',
  'job',
  'event',
  'ad',
  'notice',
]);

function normalizeCategory(raw?: string | null): BulletinCategoryValue {
  const clean = String(raw || 'announcement').toLowerCase() as BulletinCategoryValue;
  return VALID_CATEGORIES.has(clean) ? clean : 'announcement';
}

export function BulletinComposerModal({
  isOpen: isOpenProp,
  open: openProp,
  onClose,
  onPublished,
  initialMode = 'compose',
  editingBulletin = null,
}: BulletinComposerModalProps) {
  const isOpen = Boolean(isOpenProp ?? openProp);
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';
  const userPhone = typeof user?.phone === 'string' ? user.phone : '';
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();

  const [mode, setMode] = useState<'compose' | 'plans'>(initialMode);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);

  // Plan & Quota metadata
  const [plans, setPlans] = useState<SubscriptionPlanRow[]>([]);
  const [activeSub, setActiveSub] = useState<ActiveSubscriptionSummary | null>(
    null
  );
  const [monthlyUsed, setMonthlyUsed] = useState(0);
  const [activeUsed, setActiveUsed] = useState(0);
  const [availablePasses, setAvailablePasses] = useState(0);
  const [isTrialEligible, setIsTrialEligible] = useState(false);
  const [userListings, setUserListings] = useState<OwnerListingOption[]>([]);

  // Composer form fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<BulletinCategoryValue>('announcement');
  const [bodyText, setBodyText] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [contactWebsite, setContactWebsite] = useState('');
  const [linkedListingId, setLinkedListingId] = useState('');
  const [expiresAtDate, setExpiresAtDate] = useState('');
  const [includeVenuePin, setIncludeVenuePin] = useState(false);
  const [venueLabel, setVenueLabel] = useState('');
  const [venueCoords, setVenueCoords] = useState<LatLngPoint>(
    CHURACHANDPUR_FALLBACK_CENTER
  );

  // Touched & submit state for strict touch/blur + submit validation
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  // Payment / Trial modals
  const [isStartingTrialId, setIsStartingTrialId] = useState<string | null>(null);
  const [isCreatingPlanIntent, setIsCreatingPlanIntent] = useState<string | null>(
    null
  );
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentRecord | null>(
    null
  );
  const [paymentUpiDetails, setPaymentUpiDetails] = useState<{
    upiId?: string;
    upiPayeeName?: string;
  }>({});
  const [payPerPostTarget, setPayPerPostTarget] =
    useState<PayPerPostMeta | null>(null);

  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isEditing = Boolean(editingBulletin?.id);

  // Reset form state whenever modal opens or target editing bulletin changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const resetForm = () => {
      if (cancelled) return;
      const nextMode = editingBulletin ? 'compose' : initialMode;
      setMode(nextMode);
      setFeedback(null);
      setTouched({});
      setSubmitAttempted(false);

    if (editingBulletin) {
      const nextTitle = editingBulletin.title || '';
      const nextCat = normalizeCategory(editingBulletin.category);
      const nextBody = extractPlainTextFromContent(
        editingBulletin.content_json,
        editingBulletin.content_plain
      );
      const nextImgs = Array.isArray(editingBulletin.image_urls)
        ? editingBulletin.image_urls.filter(Boolean)
        : [];
      const nextYt = editingBulletin.youtube_video_id
        ? `https://youtu.be/${editingBulletin.youtube_video_id}`
        : '';
      const ch = editingBulletin.contact_channels || {};
      const nextPhone = ch.phone ? normalizePhoneToE164(ch.phone) : '';
      const nextWa = ch.whatsapp ? normalizePhoneToE164(ch.whatsapp) : '';
      const nextWeb = ch.website || '';
      const nextLinked = editingBulletin.linked_listing_id || '';
      const nextExp = editingBulletin.expires_at
        ? editingBulletin.expires_at.slice(0, 10)
        : '';
      const vLat = editingBulletin.venue_lat ?? ch.venue?.lat ?? null;
      const vLng = editingBulletin.venue_lng ?? ch.venue?.lng ?? null;
      const vLabel = editingBulletin.venue_label ?? ch.venue?.label ?? '';
      const hasVenue =
        typeof vLat === 'number' &&
        typeof vLng === 'number' &&
        Number.isFinite(vLat) &&
        Number.isFinite(vLng);

      setTitle(nextTitle);
      setCategory(nextCat);
      setBodyText(nextBody);
      setImageUrls(nextImgs);
      setYoutubeUrlInput(nextYt);
      setContactPhone(nextPhone);
      setContactWhatsapp(nextWa);
      setContactWebsite(nextWeb);
      setLinkedListingId(nextLinked);
      setExpiresAtDate(nextExp);
      setIncludeVenuePin(hasVenue);
      setVenueLabel(vLabel);
      setVenueCoords(
        hasVenue
          ? { lat: vLat, lng: vLng }
          : CHURACHANDPUR_FALLBACK_CENTER
      );

      setInitialSnapshot(
        JSON.stringify({
          title: nextTitle,
          category: nextCat,
          bodyText: nextBody,
          imageUrls: nextImgs,
          youtubeUrlInput: nextYt,
          contactPhone: nextPhone,
          contactWhatsapp: nextWa,
          contactWebsite: nextWeb,
          linkedListingId: nextLinked,
          expiresAtDate: nextExp,
          includeVenuePin: hasVenue,
          venueLabel: vLabel,
          venueCoords: hasVenue
            ? { lat: vLat, lng: vLng }
            : CHURACHANDPUR_FALLBACK_CENTER,
        })
      );
    } else {
      const defaultExp = new Date(Date.now() + 14 * 86400000)
        .toISOString()
        .slice(0, 10);
      setTitle('');
      setCategory('announcement');
      setBodyText('');
      setImageUrls([]);
      setYoutubeUrlInput('');
      setContactPhone(userPhone ? normalizePhoneToE164(userPhone) : '');
      setContactWhatsapp('');
      setContactWebsite('');
      setLinkedListingId('');
      setExpiresAtDate(defaultExp);
      setIncludeVenuePin(false);
      setVenueLabel('');
      setVenueCoords(CHURACHANDPUR_FALLBACK_CENTER);

      setInitialSnapshot(
        JSON.stringify({
          title: '',
          category: 'announcement',
          bodyText: '',
          imageUrls: [],
          youtubeUrlInput: '',
          contactPhone: userPhone ? normalizePhoneToE164(userPhone) : '',
          contactWhatsapp: '',
          contactWebsite: '',
          linkedListingId: '',
          expiresAtDate: defaultExp,
          includeVenuePin: false,
          venueLabel: '',
          venueCoords: CHURACHANDPUR_FALLBACK_CENTER,
        })
      );
    }
    };

    void Promise.resolve().then(resetForm);
    return () => {
      cancelled = true;
    };
  }, [isOpen, initialMode, editingBulletin, userPhone]);

  // Hydrate subscription quota, plans, passes, and owner listings
  const loadComposerMeta = useCallback(async () => {
    if (!isOpen || !isSupabaseConfigured()) return;
    setIsLoadingMeta(true);

    try {
      const plansReq = supabase
        .from('subscription_plans')
        .select(
          'id, slug, name, title, tagline, info, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post, allow_youtube, duration_days, trial_days, is_default_free, is_archived, target_scope, entitlements, display_order'
        )
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (!user) {
        const { data: planData } = await plansReq;
        setPlans(
          ((planData || []) as SubscriptionPlanRow[]).filter(
            (p) => !p.is_archived && !p.is_default_free
          )
        );
        setIsLoadingMeta(false);
        return;
      }

      const [plansRes, summaryRes, passesRes, listingsRes] =
        await Promise.allSettled([
          plansReq,
          supabase.rpc('get_advertiser_workspace_summary'),
          supabase
            .from('bulletin_post_passes')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'available')
            .is('used_bulletin_id', null),
          supabase
            .from('listings')
            .select('id, title, category')
            .eq('owner_id', user.id)
            .in('status', ['published', 'approved'])
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

      if (plansRes.status === 'fulfilled' && Array.isArray(plansRes.value.data)) {
        setPlans(
          (plansRes.value.data as SubscriptionPlanRow[]).filter(
            (p) => !p.is_archived && !p.is_default_free
          )
        );
      }

      if (
        passesRes.status === 'fulfilled' &&
        typeof passesRes.value.count === 'number'
      ) {
        setAvailablePasses(passesRes.value.count);
      }

      if (
        listingsRes.status === 'fulfilled' &&
        Array.isArray(listingsRes.value.data)
      ) {
        setUserListings(listingsRes.value.data as OwnerListingOption[]);
      }

      if (
        summaryRes.status === 'fulfilled' &&
        !summaryRes.value.error &&
        summaryRes.value.data &&
        typeof summaryRes.value.data === 'object'
      ) {
        const raw = summaryRes.value.data as Record<string, unknown>;
        const sub = (raw.active_subscription || {}) as Record<string, unknown>;
        const quota = (raw.quota_usage || {}) as Record<string, unknown>;
        const prof = (raw.profile || {}) as Record<string, unknown>;

        setIsTrialEligible(Boolean(prof.is_trial_eligible));
        setMonthlyUsed(Number(quota.monthly_used ?? 0));
        setActiveUsed(Number(quota.active_used ?? 0));

        setActiveSub({
          id: String(sub.subscription_id || ''),
          plan_id: String(sub.plan_id || ''),
          plan_name: String(sub.plan_name || 'Default Free Tier'),
          plan_slug: String(sub.plan_slug || 'default-free-tier'),
          status: String(sub.status || 'default_free'),
          is_trial: Boolean(sub.is_trial),
          max_active_bulletins:
            typeof quota.active_limit === 'number' ? quota.active_limit : null,
          max_monthly_posts:
            typeof quota.monthly_limit === 'number' ? quota.monthly_limit : null,
          max_images_per_post: Math.max(
            1,
            Number(quota.max_images_per_post ?? 3)
          ),
          allow_youtube: Boolean(quota.allow_youtube),
          auto_verify_bulletins: Boolean(raw.auto_verify_bulletins),
          ends_at: typeof sub.ends_at === 'string' ? sub.ends_at : null,
        });
      } else {
        // Fallback direct query when v20a RPC has not been applied yet
        const [subRes, profRes, bulRes] = await Promise.allSettled([
          supabase
            .from('user_subscriptions')
            .select(
              'id, plan_id, status, ends_at, expires_at, subscription_plans(slug, name, title, max_active_bulletins, max_monthly_posts, max_images_per_post, allow_youtube, entitlements)'
            )
            .eq('user_id', user.id)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('trial_used_at')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('bulletins')
            .select('id, status, created_at, expires_at, paid_until')
            .eq('author_id', user.id),
        ]);

        if (profRes.status === 'fulfilled') {
          setIsTrialEligible(!profRes.value.data?.trial_used_at);
        }

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const rows =
          bulRes.status === 'fulfilled' && Array.isArray(bulRes.value.data)
            ? (bulRes.value.data as Array<Record<string, unknown>>)
            : [];
        const mUsed = rows.filter(
          (r) =>
            typeof r.created_at === 'string' &&
            new Date(r.created_at) >= startOfMonth
        ).length;
        const aUsed = rows.filter((r) => r.status === 'published').length;
        setMonthlyUsed(mUsed);
        setActiveUsed(aUsed);

        const subData =
          subRes.status === 'fulfilled'
            ? (subRes.value.data as Record<string, unknown> | null)
            : null;
        const planJoin = subData?.subscription_plans as
          | Record<string, unknown>
          | null
          | undefined;

        if (subData && planJoin) {
          const ent = (planJoin.entitlements || {}) as Record<string, unknown>;
          setActiveSub({
            id: String(subData.id || ''),
            plan_id: String(subData.plan_id || ''),
            plan_name: String(planJoin.title || planJoin.name || 'Active Plan'),
            plan_slug: String(planJoin.slug || 'active'),
            status: String(subData.status || 'active'),
            is_trial: subData.status === 'trialing',
            max_active_bulletins: Number(planJoin.max_active_bulletins ?? 0),
            max_monthly_posts: Number(planJoin.max_monthly_posts ?? 0),
            max_images_per_post: Math.max(
              1,
              Number(planJoin.max_images_per_post ?? 4)
            ),
            allow_youtube: Boolean(planJoin.allow_youtube),
            auto_verify_bulletins: Boolean(ent.auto_verify_bulletins),
            ends_at:
              typeof subData.ends_at === 'string'
                ? subData.ends_at
                : typeof subData.expires_at === 'string'
                  ? subData.expires_at
                  : null,
          });
        } else {
          setActiveSub({
            id: '',
            plan_id: '',
            plan_name: 'Default Free Tier',
            plan_slug: 'default-free-tier',
            status: 'default_free',
            is_trial: false,
            max_active_bulletins: 0,
            max_monthly_posts: 0,
            max_images_per_post: 3,
            allow_youtube: false,
            auto_verify_bulletins: false,
            ends_at: null,
          });
        }
      }
    } finally {
      setIsLoadingMeta(false);
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadComposerMeta();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadComposerMeta]);

  // Derived entitlements & remaining quota
  const isPrivileged = Boolean(isAdmin || isSuperAdmin);
  const monthlyLimit = isPrivileged ? null : activeSub?.max_monthly_posts ?? 0;
  const activeLimit = isPrivileged ? null : activeSub?.max_active_bulletins ?? 0;
  const maxImagesAllowed = isPrivileged
    ? 8
    : Math.max(1, activeSub?.max_images_per_post ?? 3);

  const monthlyRemaining =
    monthlyLimit === null ? null : Math.max(0, monthlyLimit - monthlyUsed);
  const activeRemaining =
    activeLimit === null ? null : Math.max(0, activeLimit - activeUsed);

  const hasPlanQuotaToPublish =
    isPrivileged ||
    ((monthlyLimit === null || monthlyUsed < monthlyLimit) &&
      (activeLimit === null || activeUsed < activeLimit) &&
      (monthlyLimit === null || monthlyLimit > 0));

  const canPublishDirectly = hasPlanQuotaToPublish || availablePasses > 0;
  const requiresPayPerPublish = !isEditing && !canPublishDirectly;

  // Allow YouTube if privileged, plan includes YouTube, or publishing via Pay-Per (which offers YouTube boost)
  const allowYouTubeInput =
    isPrivileged || Boolean(activeSub?.allow_youtube) || requiresPayPerPublish;

  const youtubeParsed = useMemo(
    () => parseStrictYouTubeInput(youtubeUrlInput),
    [youtubeUrlInput]
  );

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        title,
        category,
        bodyText,
        imageUrls,
        youtubeUrlInput,
        contactPhone,
        contactWhatsapp,
        contactWebsite,
        linkedListingId,
        expiresAtDate,
        includeVenuePin,
        venueLabel,
        venueCoords,
      }),
    [
      title,
      category,
      bodyText,
      imageUrls,
      youtubeUrlInput,
      contactPhone,
      contactWhatsapp,
      contactWebsite,
      linkedListingId,
      expiresAtDate,
      includeVenuePin,
      venueLabel,
      venueCoords,
    ]
  );

  const isDirty = Boolean(
    isOpen &&
      mode === 'compose' &&
      initialSnapshot !== '' &&
      currentSnapshot !== initialSnapshot
  );

  // Strict field validation (displayed only on touched[field] || submitAttempted)
  const fieldErrors = useMemo(() => {
    const errs: Record<string, string> = {};

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      errs.title = 'Headline is required.';
    } else if (cleanTitle.length < 6) {
      errs.title = 'Headline must be at least 6 characters.';
    } else if (cleanTitle.length > 140) {
      errs.title = 'Headline must be 140 characters or fewer.';
    }

    const cleanBody = bodyText.trim();
    if (!cleanBody) {
      errs.bodyText = 'Notice details are required.';
    } else if (cleanBody.length < 20) {
      errs.bodyText = 'Please provide at least 20 characters of details.';
    }

    if (youtubeUrlInput.trim()) {
      if (!allowYouTubeInput) {
        errs.youtubeUrlInput =
          'Your current plan does not include YouTube video embeds. Upgrade or use Pay-Per YouTube Boost.';
      } else if (youtubeParsed.error) {
        errs.youtubeUrlInput = youtubeParsed.error;
      }
    }

    if (contactPhone.trim() && !isValidCountryPhone(contactPhone)) {
      errs.contactPhone = 'Enter a valid 10-digit Indian phone number (+91).';
    }

    if (contactWhatsapp.trim() && !isValidCountryPhone(contactWhatsapp)) {
      errs.contactWhatsapp =
        'Enter a valid 10-digit WhatsApp number (+91).';
    }

    if (contactWebsite.trim()) {
      const safeUrl = sanitizeBulletinHref(
        /^https?:\/\//i.test(contactWebsite.trim())
          ? contactWebsite.trim()
          : `https://${contactWebsite.trim()}`
      );
      if (!safeUrl || !safeUrl.startsWith('http')) {
        errs.contactWebsite = 'Enter a valid http:// or https:// website link.';
      }
    }

    if (includeVenuePin && !venueLabel.trim()) {
      errs.venueLabel = 'Enter a venue name or landmark for the pinned location.';
    }

    if (imageUrls.length > maxImagesAllowed) {
      errs.imageUrls = `At most ${maxImagesAllowed} image${maxImagesAllowed === 1 ? '' : 's'} allowed on your current plan.`;
    }

    return errs;
  }, [
    title,
    bodyText,
    youtubeUrlInput,
    allowYouTubeInput,
    youtubeParsed.error,
    contactPhone,
    contactWhatsapp,
    contactWebsite,
    includeVenuePin,
    venueLabel,
    imageUrls.length,
    maxImagesAllowed,
  ]);

  const validationSummary = useMemo(
    () => Object.values(fieldErrors),
    [fieldErrors]
  );
  const isFormValid = validationSummary.length === 0;

  const markTouched = (field: string) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const showFieldError = (field: string): string | null => {
    if (!touched[field] && !submitAttempted) return null;
    return fieldErrors[field] || null;
  };

  const handleImageFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !user) return;

    const remainingSlots = Math.max(0, maxImagesAllowed - imageUrls.length);
    if (remainingSlots <= 0) {
      setFeedback({
        type: 'error',
        text: `You have reached the ${maxImagesAllowed}-image limit for this bulletin.`,
      });
      return;
    }

    const batch = files.slice(0, remainingSlots);
    setIsUploadingImage(true);
    setFeedback(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const uploaded: string[] = [];
      for (const file of batch) {
        if (!file.type.startsWith('image/')) continue;
        const compressed = await compressImageWithPreset(file, 'gallery');
        const formData = new FormData();
        formData.append('file', compressed.file);
        formData.append('entityType', 'bulletin_media');
        formData.append('retentionClass', 'ephemeral_ttl');
        formData.append('ttlDays', '30');
        if (editingBulletin?.id) {
          formData.append('entityId', editingBulletin.id);
        }
        const headers: Record<string, string> = {};
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }
        const res = await fetch('/api/media/upload', {
          method: 'POST',
          headers,
          body: formData,
        });
        const json = (await res.json()) as {
          url?: string;
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !json.success || !json.url) {
          throw new Error(json.error || 'Unable to upload bulletin image.');
        }
        uploaded.push(json.url);
      }
      if (uploaded.length > 0) {
        setImageUrls((prev) => [...prev, ...uploaded]);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to upload image attachment.',
      });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSubmitBulletin = async () => {
    if (!user) {
      setFeedback({
        type: 'error',
        text: 'Please sign in to publish or update a bulletin.',
      });
      return;
    }

    setSubmitAttempted(true);
    if (!isFormValid) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const cleanWebsite = contactWebsite.trim()
        ? sanitizeBulletinHref(
            /^https?:\/\//i.test(contactWebsite.trim())
              ? contactWebsite.trim()
              : `https://${contactWebsite.trim()}`
          )
        : null;

      const contactChannels: Record<string, unknown> = {};
      if (contactPhone.trim()) {
        contactChannels.phone = normalizePhoneToE164(contactPhone);
      }
      if (contactWhatsapp.trim()) {
        contactChannels.whatsapp = normalizePhoneToE164(contactWhatsapp);
      }
      if (cleanWebsite) {
        contactChannels.website = cleanWebsite;
      }
      if (includeVenuePin) {
        contactChannels.venue = {
          label: venueLabel.trim(),
          lat: venueCoords.lat,
          lng: venueCoords.lng,
        };
      }

      const contentDoc = buildTiptapDocFromPlainText(bodyText.trim());
      const expiresIso = expiresAtDate
        ? new Date(`${expiresAtDate}T23:59:59+05:30`).toISOString()
        : new Date(Date.now() + 14 * 86400000).toISOString();

      const basePayload: Record<string, unknown> = {
        title: title.trim(),
        category,
        content_json: contentDoc,
        content_plain: bodyText.trim(),
        image_urls: imageUrls,
        youtube_video_id: youtubeParsed.videoId,
        contact_channels: contactChannels,
        linked_listing_id: linkedListingId || null,
        expires_at: expiresIso,
      };

      const venueColumns: Record<string, unknown> = includeVenuePin
        ? {
            venue_label: venueLabel.trim(),
            venue_lat: venueCoords.lat,
            venue_lng: venueCoords.lng,
          }
        : {
            venue_label: null,
            venue_lat: null,
            venue_lng: null,
          };

      if (isEditing && editingBulletin) {
        let { error: updErr } = await supabase
          .from('bulletins')
          .update({ ...basePayload, ...venueColumns })
          .eq('id', editingBulletin.id)
          .eq('author_id', user.id);

        // Graceful fallback if optional v20a venue columns haven't been migrated yet
        if (updErr && /column .*venue_/i.test(updErr.message)) {
          const retry = await supabase
            .from('bulletins')
            .update(basePayload)
            .eq('id', editingBulletin.id)
            .eq('author_id', user.id);
          updErr = retry.error;
        }

        if (updErr) {
          throw new Error(updErr.message);
        }

        onPublished?.();
        onClose();
        return;
      }

      // Create new bulletin
      const nextStatus = requiresPayPerPublish ? 'pending_payment' : 'published';
      const insertRow: Record<string, unknown> = {
        ...basePayload,
        ...venueColumns,
        author_id: user.id,
        status: nextStatus,
      };

      let insertRes = await supabase
        .from('bulletins')
        .insert(insertRow)
        .select('id, title')
        .single();

      // Fallback if venue_* columns or pending_payment check aren't applied yet
      if (insertRes.error && /column .*venue_/i.test(insertRes.error.message)) {
        const retryRow = { ...basePayload, author_id: user.id, status: nextStatus };
        insertRes = await supabase
          .from('bulletins')
          .insert(retryRow)
          .select('id, title')
          .single();
      }
      if (
        insertRes.error &&
        requiresPayPerPublish &&
        /status/i.test(insertRes.error.message)
      ) {
        const retryRow = { ...basePayload, author_id: user.id, status: 'draft' };
        insertRes = await supabase
          .from('bulletins')
          .insert(retryRow)
          .select('id, title')
          .single();
      }

      if (insertRes.error || !insertRes.data) {
        throw new Error(
          insertRes.error?.message || 'Unable to save your bulletin notice.'
        );
      }

      if (requiresPayPerPublish) {
        setPayPerPostTarget({
          id: String(insertRes.data.id),
          title: String(insertRes.data.title || title.trim()),
          hasYouTube: Boolean(youtubeParsed.videoId),
        });
        onPublished?.();
        return;
      }

      onPublished?.();
      onClose();
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to save bulletin. Please verify your fields and try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartPlanTrial = async (plan: SubscriptionPlanRow) => {
    const days = Number(plan.trial_days || 0);
    if (days <= 0) return;
    const planLabel = plan.title || plan.name;

    const accepted = await confirm({
      title: `Start ${days}-Day Free Trial on "${planLabel}"?`,
      description: `Activate "${planLabel}" immediately for ${days} days at ₹0. Each account receives one free trial.`,
      caution:
        'After the trial ends, your bulletins remain safe and your account returns to the Default Free Tier unless renewed.',
      impactSummary: [
        `Plan: ${planLabel}`,
        `Monthly quota: ${plan.max_monthly_posts} bulletins / month`,
        `Trial period: ${days} days (₹0 today)`,
      ],
      confirmLabel: `Start ${days}-Day Free Trial`,
      cancelLabel: 'Not Now',
      variant: 'info',
    });
    if (!accepted) return;

    setIsStartingTrialId(plan.id);
    setFeedback(null);
    try {
      const { error } = await supabase.rpc('start_plan_trial', {
        p_plan_id: plan.id,
      });
      if (error) throw new Error(error.message);
      setFeedback({
        type: 'success',
        text: `Activated ${days}-day free trial on "${planLabel}". You can now publish under your plan quota.`,
      });
      await loadComposerMeta();
      onPublished?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to activate free trial right now.',
      });
    } finally {
      setIsStartingTrialId(null);
    }
  };

  const handleSubscribePlan = async (plan: SubscriptionPlanRow) => {
    if (!user) {
      setFeedback({
        type: 'error',
        text: 'Please sign in first to subscribe to an advertiser plan.',
      });
      return;
    }

    const planLabel = plan.title || plan.name;
    const accepted = await confirm({
      title: `Subscribe to "${planLabel}" (₹${plan.price_inr.toLocaleString('en-IN')})?`,
      description: `Opens secure UPI checkout for ${plan.duration_days} days of "${planLabel}" access (${plan.max_monthly_posts} monthly bulletins, ${plan.max_active_bulletins} active).`,
      impactSummary: [
        `Amount: ₹${plan.price_inr.toLocaleString('en-IN')}`,
        `Duration: ${plan.duration_days} days`,
      ],
      confirmLabel: 'Proceed to UPI Checkout',
      cancelLabel: 'Cancel',
      variant: 'info',
    });
    if (!accepted) return;

    setIsCreatingPlanIntent(plan.id);
    setFeedback(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in again to start subscription checkout.');
      }
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          purpose: 'bulletin_subscription',
          planId: plan.id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        intent?: PaymentIntentRecord;
        upi_id?: string;
        upi_payee_name?: string;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(
          json.error || 'Could not start plan checkout right now.'
        );
      }
      setPaymentUpiDetails({
        upiId: json.upi_id,
        upiPayeeName: json.upi_payee_name,
      });
      setPaymentIntent(json.intent);
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not start plan checkout right now.',
      });
    } finally {
      setIsCreatingPlanIntent(null);
    }
  };

  const composeHints = [
    'Use a clear headline naming the locality, shop, or event date so Churachandpur readers find it immediately.',
    'YouTube links are automatically sanitized and rendered through privacy-enhanced youtube-nocookie.com.',
    'Add an Event venue pin so residents can navigate directly from the bulletin card.',
  ];

  const composeCautions = [
    requiresPayPerPublish
      ? 'Your current plan quota is exhausted — submitting saves this notice and opens Pay-Per checkout immediately so it goes live once verified.'
      : activeSub?.auto_verify_bulletins
        ? 'Auto-Verified via Plan is enabled — your notice publishes directly with a Verified badge.'
        : 'Notices without plan auto-verification may undergo community moderation review.',
  ];

  if (!isOpen) return null;

  return (
    <>
      {mode === 'compose' ? (
        <FormModal
          isOpen={isOpen}
          onClose={onClose}
          title={isEditing ? 'Edit Bulletin Notice' : 'Publish Community Bulletin'}
          subtitle={
            isEditing
              ? 'Update your notice details, contact channels, YouTube embed, or event venue.'
              : 'Share local announcements, jobs, events, or promotions on the Churachandpur Bulletin board.'
          }
          hints={composeHints}
          cautions={composeCautions}
          isDirty={isDirty}
          isValid={isFormValid}
          validationSummary={
            submitAttempted ? validationSummary : undefined
          }
          onSubmitAttempt={() => setSubmitAttempted(true)}
          submitLabel={
            isEditing
              ? 'Save Bulletin Changes'
              : requiresPayPerPublish
                ? 'Save & Pay-Per Publish'
                : 'Publish Bulletin'
          }
          confirmSubmitTitle={
            isEditing
              ? 'Save Bulletin Updates?'
              : requiresPayPerPublish
                ? 'Save Notice & Open Pay-Per Checkout?'
                : 'Publish Bulletin Now?'
          }
          confirmSubmitDescription={
            isEditing
              ? 'Your updated bulletin details will reflect immediately on the live board.'
              : requiresPayPerPublish
                ? 'Your notice will be saved cleanly as pending payment, then Pay-Per Checkout will open so you can choose a 3–30 day visibility slab.'
                : 'Your bulletin will be posted under your active plan quota.'
          }
          confirmSubmitImpact={[
            `Title: ${title.trim() || 'Untitled'}`,
            `Category: ${BULLETIN_CATEGORY_OPTIONS.find((c) => c.value === category)?.label || category}`,
            youtubeParsed.videoId
              ? `YouTube Video ID: ${youtubeParsed.videoId}`
              : 'No video attached',
          ]}
          isSubmitting={isSubmitting}
          maxWidthClassName="max-w-2xl"
          onSubmit={handleSubmitBulletin}
        >
          <div className="space-y-4">
            {/* Mode toggle & Monetization Quota Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {!isEditing && (
                <div className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-1">
                  <button
                    type="button"
                    onClick={() => setMode('compose')}
                    className="min-h-[36px] rounded-lg bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-bold text-[var(--ps-text)] shadow-2xs cursor-pointer"
                  >
                    Compose Notice
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('plans')}
                    className="min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    Advertiser Plans &amp; Trials
                  </button>
                </div>
              )}

              {activeSub?.auto_verify_bulletins && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Auto-Verified via Plan</span>
                </span>
              )}
            </div>

            {/* Plan Quota vs Pay-Per Status Banner */}
            {isLoadingMeta ? (
              <div className="dd-shimmer h-14 w-full rounded-xl" />
            ) : (
              <div
                data-testid="bulletin-composer-quota-banner"
                className={`rounded-xl border p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                  requiresPayPerPublish
                    ? 'border-amber-500/35 bg-amber-500/10 text-[var(--ps-text)]'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-[var(--ps-text)]'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {requiresPayPerPublish ? (
                    <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-bold">
                      {isEditing
                        ? `Editing under ${activeSub?.plan_name || 'your account'}`
                        : isPrivileged
                          ? 'Admin / Super-Admin Unlimited Publishing'
                          : hasPlanQuotaToPublish
                            ? `Included in your ${activeSub?.plan_name || 'Active Plan'} (${
                                monthlyRemaining === null
                                  ? 'Unlimited'
                                  : `${monthlyRemaining} remaining this month`
                              })`
                            : availablePasses > 0
                              ? `Included via Verified Post Pass (${availablePasses} available)`
                              : 'Pay-Per Publish Required (or Upgrade Plan)'}
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      {requiresPayPerPublish
                        ? `Your ${activeSub?.plan_name || 'Default Free Tier'} has ${monthlyUsed}/${monthlyLimit ?? 0} monthly quota used. Submit to pick a 3–30 day Pay-Per slab, or activate a Free Trial.`
                        : `Up to ${maxImagesAllowed} images per post${
                            allowYouTubeInput ? ' • YouTube embeds enabled' : ''
                          }.`}
                    </p>
                  </div>
                </div>

                {requiresPayPerPublish && !isEditing && (
                  <button
                    type="button"
                    onClick={() => setMode('plans')}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-bold text-[var(--ps-accent)] hover:border-[var(--ps-accent)]/50 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{isTrialEligible ? 'Try Free Trial' : 'View Plans'}</span>
                  </button>
                )}
              </div>
            )}

            {feedback && (
              <div
                role="alert"
                className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-start gap-2 ${
                  feedback.type === 'error'
                    ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Category Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--ps-text)]">
                Notice Category <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {BULLETIN_CATEGORY_OPTIONS.map((opt) => {
                  const active = category === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setCategory(opt.value);
                        if (opt.value === 'event') {
                          setIncludeVenuePin(true);
                        }
                      }}
                      className={`min-h-[44px] rounded-xl border px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1">
              <label
                htmlFor="bulletin-title-input"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Headline <span className="text-rose-500">*</span>
              </label>
              <input
                id="bulletin-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => markTouched('title')}
                maxLength={140}
                placeholder="e.g., Lamka Youth Football Cup Registration Open"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {showFieldError('title') && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {showFieldError('title')}
                </p>
              )}
            </div>

            {/* Body / Details */}
            <div className="space-y-1">
              <label
                htmlFor="bulletin-body-input"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Notice Details <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="bulletin-body-input"
                rows={5}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                onBlur={() => markTouched('bodyText')}
                placeholder="Share key dates, eligibility, pricing, timings, and how readers should reach you..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none resize-y"
              />
              {showFieldError('bodyText') && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {showFieldError('bodyText')}
                </p>
              )}
            </div>

            {/* Strict YouTube URL Parser & Privacy-Enhanced Embed Preview */}
            <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="bulletin-youtube-input"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]"
                >
                  <Video className="h-3.5 w-3.5 text-rose-500" />
                  <span>YouTube Video Notice (Optional)</span>
                </label>
                {!allowYouTubeInput && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    Requires Pro Plan or Pay-Per Boost
                  </span>
                )}
              </div>
              <input
                id="bulletin-youtube-input"
                type="url"
                value={youtubeUrlInput}
                onChange={(e) => setYoutubeUrlInput(e.target.value)}
                onBlur={() => markTouched('youtubeUrlInput')}
                placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ or https://youtu.be/..."
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {showFieldError('youtubeUrlInput') && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {showFieldError('youtubeUrlInput')}
                </p>
              )}
              {youtubeParsed.videoId && allowYouTubeInput && (
                <div className="pt-1 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">
                    <span>
                      Valid YouTube ID extracted: {youtubeParsed.videoId}
                    </span>
                    <span className="text-[10px] text-[var(--ps-text-muted)]">
                      youtube-nocookie.com sandbox
                    </span>
                  </div>
                  <YouTubeEmbedPlayer
                    videoId={youtubeParsed.videoId}
                    title={title.trim() || 'YouTube preview'}
                  />
                </div>
              )}
            </div>

            {/* Image Attachments */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--ps-text)]">
                  Photos ({imageUrls.length} / {maxImagesAllowed})
                </span>
                <button
                  type="button"
                  disabled={
                    isUploadingImage || imageUrls.length >= maxImagesAllowed
                  }
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]/50 disabled:opacity-50 cursor-pointer"
                >
                  <ImagePlus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>
                    {isUploadingImage ? 'Uploading…' : 'Upload Poster / Photo'}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void handleImageFilesSelected(e)}
                  className="hidden"
                />
              </div>

              {imageUrls.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {imageUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative aspect-square rounded-xl overflow-hidden border border-[var(--ps-border)] bg-[var(--ps-bg)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Attachment ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setImageUrls((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        aria-label="Remove attachment"
                        className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950/75 text-white hover:bg-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {showFieldError('imageUrls') && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {showFieldError('imageUrls')}
                </p>
              )}
            </div>

            {/* Contact Channels (+91 PhoneInput & Website) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <PhoneInput
                  label="Contact Phone (+91)"
                  value={contactPhone}
                  onChange={(val) => {
                    setContactPhone(val);
                    markTouched('contactPhone');
                  }}
                  error={showFieldError('contactPhone') || undefined}
                />
              </div>
              <div>
                <PhoneInput
                  label="WhatsApp Number (+91)"
                  value={contactWhatsapp}
                  onChange={(val) => {
                    setContactWhatsapp(val);
                    markTouched('contactWhatsapp');
                  }}
                  error={showFieldError('contactWhatsapp') || undefined}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="bulletin-website-input"
                  className="inline-flex items-center gap-1 text-xs font-bold text-[var(--ps-text)]"
                >
                  <Link2 className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                  <span>Registration / Website URL (Optional)</span>
                </label>
                <input
                  id="bulletin-website-input"
                  type="url"
                  value={contactWebsite}
                  onChange={(e) => setContactWebsite(e.target.value)}
                  onBlur={() => markTouched('contactWebsite')}
                  placeholder="https://example.com/register"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
                {showFieldError('contactWebsite') && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {showFieldError('contactWebsite')}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="bulletin-expiry-input"
                  className="inline-flex items-center gap-1 text-xs font-bold text-[var(--ps-text)]"
                >
                  <Calendar className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                  <span>Display Until Date</span>
                </label>
                <input
                  id="bulletin-expiry-input"
                  type="date"
                  value={expiresAtDate}
                  onChange={(e) => setExpiresAtDate(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
              </div>
            </div>

            {/* Linked Business Listing (Optional) */}
            {userListings.length > 0 && (
              <div className="space-y-1">
                <label
                  htmlFor="bulletin-linked-listing"
                  className="block text-xs font-bold text-[var(--ps-text)]"
                >
                  Link to One of Your Verified Businesses (Optional)
                </label>
                <select
                  id="bulletin-linked-listing"
                  value={linkedListingId}
                  onChange={(e) => setLinkedListingId(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                >
                  <option value="">None (Standalone Notice)</option>
                  {userListings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                      {l.category ? ` (${l.category})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Optional Event Venue MapCoordinatePicker */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-[var(--ps-text)]">
                      Event / Notice Venue Pin (Optional)
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Pin the exact hall, ground, or shop location on the map.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeVenuePin((v) => !v)}
                  className={`min-h-[44px] rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    includeVenuePin
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
                  }`}
                >
                  {includeVenuePin ? 'Venue Pin Enabled' : 'Add Venue Pin'}
                </button>
              </div>

              {includeVenuePin && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1">
                    <label
                      htmlFor="bulletin-venue-label"
                      className="block text-xs font-bold text-[var(--ps-text)]"
                    >
                      Venue Name / Landmark <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="bulletin-venue-label"
                      type="text"
                      value={venueLabel}
                      onChange={(e) => setVenueLabel(e.target.value)}
                      onBlur={() => markTouched('venueLabel')}
                      placeholder="e.g., Peace Ground, Tuibong or YPA Hall, Hiangtam Lamka"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                    />
                    {showFieldError('venueLabel') && (
                      <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {showFieldError('venueLabel')}
                      </p>
                    )}
                  </div>

                  <MapCoordinatePicker
                    mode="point"
                    coordinates={venueCoords}
                    onChangeCoordinates={setVenueCoords}
                    label="Venue GPS Pin"
                    helperText="Click on the map or use GPS to mark the exact event venue."
                    submitAttempted={submitAttempted}
                  />
                </div>
              )}
            </div>
          </div>
        </FormModal>
      ) : (
        /* Plans & Free Trials Showcase Modal (used by /bulletin?plans=1 & Upgrade button) */
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-5">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                role="dialog"
                aria-modal="true"
                aria-label="Advertiser Subscription Plans"
                className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base sm:text-lg font-extrabold text-[var(--ps-text)] flex items-center gap-2">
                        <Crown className="h-5 w-5 text-[var(--ps-accent)] shrink-0" />
                        <span>Advertiser Plans &amp; Free Trials</span>
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                      Publish monthly notices under a plan, start a ₹0 free trial, or pay per bulletin anytime.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close plans modal"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-1">
                      <button
                        type="button"
                        onClick={() => setMode('compose')}
                        className="min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                      >
                        Compose Notice
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('plans')}
                        className="min-h-[36px] rounded-lg bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-bold text-[var(--ps-text)] shadow-2xs cursor-pointer"
                      >
                        Advertiser Plans &amp; Trials
                      </button>
                    </div>

                    {activeSub && (
                      <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1 text-[11px] font-bold text-[var(--ps-text)]">
                        Current: {activeSub.plan_name}
                      </span>
                    )}
                  </div>

                  {feedback && (
                    <div
                      role="alert"
                      className={`rounded-xl border px-3.5 py-2.5 text-xs flex items-start gap-2 ${
                        feedback.type === 'error'
                          ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{feedback.text}</span>
                    </div>
                  )}

                  {isLoadingMeta ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="dd-shimmer h-44 rounded-2xl" />
                      ))}
                    </div>
                  ) : plans.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
                      No paid plans are published right now. You can still publish any notice directly with Pay-Per-Post.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {plans.map((plan) => {
                        const planTitle = plan.title || plan.name;
                        const isVip = plan.target_scope === 'selected_users';
                        const trialDays = Number(plan.trial_days || 0);
                        const ent = (plan.entitlements || {}) as Record<
                          string,
                          unknown
                        >;
                        const autoVerify = Boolean(ent.auto_verify_bulletins);
                        const isCurrent = activeSub?.plan_id === plan.id;

                        return (
                          <div
                            key={plan.id}
                            className={`rounded-2xl border p-4 flex flex-col justify-between gap-3.5 ${
                              isVip
                                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/6'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                                      {planTitle}
                                    </h3>
                                    {isVip && (
                                      <span className="rounded-full bg-[var(--ps-accent)] px-2 py-0.5 text-[10px] font-extrabold text-[var(--ps-accent-fg)]">
                                        Special Plan for You
                                      </span>
                                    )}
                                    {isCurrent && (
                                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                        Current Plan
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                                    {plan.info || plan.tagline || 'Unified local advertiser plan'}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-base font-extrabold text-[var(--ps-text)] tabular-nums">
                                    ₹{Number(plan.price_inr || 0).toLocaleString('en-IN')}
                                  </div>
                                  <div className="text-[10px] text-[var(--ps-text-muted)]">
                                    / {plan.duration_days} days
                                  </div>
                                </div>
                              </div>

                              <ul className="space-y-1 text-[11px] text-[var(--ps-text-muted)] pt-1">
                                <li className="flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span>
                                    Up to {plan.max_monthly_posts} bulletins/month ({plan.max_active_bulletins} active)
                                  </span>
                                </li>
                                <li className="flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span>
                                    Up to {plan.max_images_per_post} images/post
                                    {plan.allow_youtube ? ' + YouTube Video Embeds' : ''}
                                  </span>
                                </li>
                                {autoVerify && (
                                  <li className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                                    <span>Auto-Verified Bulletins included</span>
                                  </li>
                                )}
                              </ul>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {isTrialEligible && trialDays > 0 && !isCurrent && (
                                <button
                                  type="button"
                                  disabled={isStartingTrialId === plan.id}
                                  onClick={() => void handleStartPlanTrial(plan)}
                                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-extrabold text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  <span>
                                    {isStartingTrialId === plan.id
                                      ? 'Activating…'
                                      : `Start ${trialDays}-Day Free Trial`}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isCreatingPlanIntent === plan.id}
                                onClick={() => void handleSubscribePlan(plan)}
                                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 py-2 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50 cursor-pointer"
                              >
                                <Megaphone className="h-3.5 w-3.5" />
                                <span>
                                  {isCreatingPlanIntent === plan.id
                                    ? 'Preparing…'
                                    : isCurrent
                                      ? 'Renew Plan'
                                      : 'Subscribe via UPI'}
                                </span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 p-3.5 text-xs text-[var(--ps-text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-[var(--ps-accent)] shrink-0 mt-0.5" />
                      <span>
                        Only need to post a single notice? Switch to <strong>Compose Notice</strong> and publish using Pay-Per-Post (from ₹49 for 3 days) without any subscription.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMode('compose')}
                      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-bold text-[var(--ps-text)] cursor-pointer"
                    >
                      <span>Compose Pay-Per Notice</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </AnimatePresence>,
          document.body
        )
      )}

      {/* Pay-Per Checkout Modal after saving a Pay-Per bulletin */}
      {payPerPostTarget && (
        <PayPerCheckoutModal
          open={Boolean(payPerPostTarget)}
          onClose={() => {
            setPayPerPostTarget(null);
            onClose();
          }}
          moduleKey="bulletin_post"
          targetTable="bulletins"
          targetId={payPerPostTarget.id}
          targetTitle={payPerPostTarget.title}
          initialAddonIds={payPerPostTarget.hasYouTube ? ['video_boost'] : []}
          onSuccess={() => {
            setPayPerPostTarget(null);
            onPublished?.();
            onClose();
          }}
        />
      )}

      {/* Universal UPI Payment Modal for Subscription Plans */}
      {paymentIntent && (
        <UniversalPaymentModal
          open={Boolean(paymentIntent)}
          intent={paymentIntent}
          upiId={paymentUpiDetails.upiId}
          upiPayeeName={paymentUpiDetails.upiPayeeName}
          title="Advertiser Subscription Checkout"
          onClose={() => setPaymentIntent(null)}
          onSubmitted={() => {
            setPaymentIntent(null);
            void loadComposerMeta();
            onPublished?.();
          }}
        />
      )}

      {confirmDialog}
    </>
  );
}

export default BulletinComposerModal;
