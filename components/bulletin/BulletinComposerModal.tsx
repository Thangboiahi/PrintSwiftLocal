'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  Globe,
  ImagePlus,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import { BulletinEditor } from '@/components/bulletin/BulletinEditor';
import {
  YouTubeEmbedPlayer,
  isValidYouTubeVideoId,
  sanitizeBulletinHref,
  type TiptapDoc,
} from '@/components/bulletin/BulletinContentRenderer';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchPlatformSettings,
  type BulletinPayPerPostConfig,
} from '@/lib/supabase/platform-settings';
import { uploadImage } from '@/lib/supabase/storage';

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  max_active_bulletins: number;
  max_monthly_posts: number;
  max_images_per_post: number;
  allow_youtube: boolean;
  duration_days: number;
}

interface OwnedListingOption {
  id: string;
  title: string;
  locality: string | null;
}

interface BulletinPostPassRow {
  id: string;
  price_inr: number;
  duration_days: number;
  upi_utr_ref: string | null;
  status: 'pending_verification' | 'available' | 'used' | 'rejected';
  used_bulletin_id: string | null;
  created_at: string;
}

interface QuotaEvaluation {
  status: 'loading' | 'unauthenticated' | 'eligible' | 'unpaid' | 'quota_reached';
  isAdminBypass: boolean;
  usingPostPass?: boolean;
  availablePassCount?: number;
  passDurationDays?: number;
  pendingPassCount?: number;
  pendingUtrRef?: string | null;
  plan: SubscriptionPlanRow | null;
  subscriptionExpiresAt: string | null;
  activeCount: number;
  monthlyCount: number;
  reason?: string;
}

export interface BulletinComposerModalProps {
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}

const DEFAULT_FALLBACK_PLANS: SubscriptionPlanRow[] = [
  {
    id: 'starter',
    slug: 'starter',
    name: 'Starter',
    price_inr: 199,
    max_active_bulletins: 2,
    max_monthly_posts: 4,
    max_images_per_post: 2,
    allow_youtube: true,
    duration_days: 30,
  },
  {
    id: 'business',
    slug: 'business',
    name: 'Business',
    price_inr: 499,
    max_active_bulletins: 5,
    max_monthly_posts: 15,
    max_images_per_post: 5,
    allow_youtube: true,
    duration_days: 30,
  },
  {
    id: 'agency',
    slug: 'agency',
    name: 'Agency',
    price_inr: 999,
    max_active_bulletins: 15,
    max_monthly_posts: 50,
    max_images_per_post: 8,
    allow_youtube: true,
    duration_days: 30,
  },
];

const CATEGORY_SELECT_OPTIONS: CustomSelectOption[] = [
  {
    value: 'announcement',
    label: 'Announcement',
    description: 'Official updates, civic notices, or organization news',
  },
  {
    value: 'job',
    label: 'Job Opening',
    description: 'Local recruitment, vacancies, and internships',
  },
  {
    value: 'advertisement',
    label: 'Advertisement',
    description: 'Shop promotions, seasonal clearances, and services',
  },
  {
    value: 'notice',
    label: 'Community Notice',
    description: 'Public advisories, blood drives, and ward notices',
  },
  {
    value: 'event',
    label: 'Event',
    description: 'Workshops, tournaments, markets, and gatherings',
  },
];

/**
 * Extracts and validates an 11-character YouTube video ID from common URL formats or raw IDs.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isValidYouTubeVideoId(trimmed)) return trimmed;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

    let candidate: string | null = null;
    if (host === 'youtu.be') {
      candidate = parsed.pathname.split('/').filter(Boolean)[0] || null;
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (parsed.pathname === '/watch') {
        candidate = parsed.searchParams.get('v');
      } else {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (
          parts.length >= 2 &&
          ['embed', 'shorts', 'live', 'v'].includes(parts[0])
        ) {
          candidate = parts[1];
        }
      }
    }

    return isValidYouTubeVideoId(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function getDefaultExpiryDateString(daysFromNow = 14): string {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTomorrowDateString(): string {
  const d = new Date(Date.now() + 86400000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const PLATFORM_UPI_ID = 'printswift.lamka@upi';

export function BulletinComposerModal({
  open,
  onClose,
  onPublished,
}: BulletinComposerModalProps) {
  const { user: authUser, role: syncedAuthRole, fullName } = useAuth();
  const { setStatus, clearStatus } = useAppStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [plans, setPlans] = useState<SubscriptionPlanRow[]>(DEFAULT_FALLBACK_PLANS);
  const [ownedListings, setOwnedListings] = useState<OwnedListingOption[]>([]);
  const [payPerPostConfig, setPayPerPostConfig] = useState<BulletinPayPerPostConfig>({
    price_inr: 79,
    duration_days: 7,
  });
  const [passUtrInput, setPassUtrInput] = useState('');
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);
  const [passFeedback, setPassFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [eligibilityNonce, setEligibilityNonce] = useState(0);
  const [quota, setQuota] = useState<QuotaEvaluation>({
    status: 'loading',
    isAdminBypass: false,
    plan: null,
    subscriptionExpiresAt: null,
    activeCount: 0,
    monthlyCount: 0,
  });

  // Form fields
  const [category, setCategory] = useState<string>('announcement');
  const [title, setTitle] = useState('');
  const [contentJson, setContentJson] = useState<TiptapDoc>({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  });
  const [plainText, setPlainText] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactWebsite, setContactWebsite] = useState('');
  const [linkedListingId, setLinkedListingId] = useState('');
  const [expiryDate, setExpiryDate] = useState(() => getDefaultExpiryDateString(14));

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedYouTubeId = useMemo(
    () => parseYouTubeVideoId(youtubeUrlInput),
    [youtubeUrlInput]
  );

  const maxImagesAllowed = quota.isAdminBypass
    ? 8
    : quota.usingPostPass
      ? 3
      : quota.plan?.max_images_per_post ?? 3;
  const allowYoutube = quota.isAdminBypass
    ? true
    : quota.usingPostPass
      ? true
      : quota.plan?.allow_youtube !== false;

  const resetForm = useCallback(() => {
    setCategory('announcement');
    setTitle('');
    setContentJson({ type: 'doc', content: [{ type: 'paragraph' }] });
    setPlainText('');
    setImageUrls([]);
    setYoutubeUrlInput('');
    setContactPhone('');
    setContactWhatsapp('');
    setContactEmail('');
    setContactWebsite('');
    setLinkedListingId('');
    setExpiryDate(getDefaultExpiryDateString());
    setFormError(null);
  }, []);

  // Load subscription eligibility, quotas, plans, and owned listings when opened
  useEffect(() => {
    if (!open) return;
    let active = true;

    async function evaluateEligibility() {
      setFormError(null);
      setQuota({
        status: 'loading',
        isAdminBypass: false,
        plan: null,
        subscriptionExpiresAt: null,
        activeCount: 0,
        monthlyCount: 0,
      });

      if (!authUser?.id) {
        if (active) {
          setQuota({
            status: 'unauthenticated',
            isAdminBypass: false,
            plan: null,
            subscriptionExpiresAt: null,
            activeCount: 0,
            monthlyCount: 0,
          });
        }
        return;
      }

      if (!isSupabaseConfigured()) {
        const lowerRole = (syncedAuthRole || '').toLowerCase();
        const isAdminRole = lowerRole === 'admin' || lowerRole === 'super_admin';
        if (active) {
          setQuota({
            status: isAdminRole ? 'eligible' : 'unpaid',
            isAdminBypass: isAdminRole,
            plan: null,
            subscriptionExpiresAt: null,
            activeCount: 0,
            monthlyCount: 0,
            reason: isAdminRole
              ? undefined
              : 'An active paid bulletin subscription is required to publish.',
          });
        }
        return;
      }

      try {
        const nowIso = new Date().toISOString();
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [plansRes, profileRes, listingsRes, platformSettings] =
          await Promise.all([
            supabase
              .from('subscription_plans')
              .select(
                'id, slug, name, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post, allow_youtube, duration_days'
              )
              .eq('is_active', true)
              .order('price_inr', { ascending: true }),
            supabase
              .from('profiles')
              .select('role')
              .eq('id', authUser.id)
              .maybeSingle(),
            supabase
              .from('listings')
              .select('id, title, locality')
              .eq('owner_id', authUser.id)
              .order('created_at', { ascending: false })
              .limit(40),
            fetchPlatformSettings(false),
          ]);

        if (!active) return;

        setPayPerPostConfig(platformSettings.bulletinPayPerPost);

        if (!plansRes.error && Array.isArray(plansRes.data) && plansRes.data.length > 0) {
          setPlans(plansRes.data as SubscriptionPlanRow[]);
        }

        if (!listingsRes.error && Array.isArray(listingsRes.data)) {
          setOwnedListings(listingsRes.data as OwnedListingOption[]);
        }

        const dbRole = String(
          (profileRes.data as { role?: string | null } | null)?.role ||
            syncedAuthRole ||
            'visitor'
        )
          .trim()
          .toLowerCase();

        // Admins and super_admins bypass paid subscription and quotas
        if (dbRole === 'admin' || dbRole === 'super_admin') {
          setQuota({
            status: 'eligible',
            isAdminBypass: true,
            plan: null,
            subscriptionExpiresAt: null,
            activeCount: 0,
            monthlyCount: 0,
          });
          return;
        }

        // Check active paid subscription + pay-per-post passes + active & monthly post counts
        const [subRes, passesRes, activeCountRes, monthlyCountRes] =
          await Promise.all([
            supabase
              .from('user_subscriptions')
              .select(
                'id, status, expires_at, subscription_plans:plan_id(id, slug, name, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post, allow_youtube, duration_days)'
              )
              .eq('user_id', authUser.id)
              .eq('status', 'active')
              .gt('expires_at', nowIso)
              .order('expires_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from('bulletin_post_passes')
              .select(
                'id, price_inr, duration_days, upi_utr_ref, status, used_bulletin_id, created_at'
              )
              .eq('user_id', authUser.id)
              .in('status', ['available', 'pending_verification'])
              .order('created_at', { ascending: true }),
            supabase
              .from('bulletins')
              .select('id', { count: 'exact', head: true })
              .eq('author_id', authUser.id)
              .eq('status', 'published')
              .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
            supabase
              .from('bulletins')
              .select('id', { count: 'exact', head: true })
              .eq('author_id', authUser.id)
              .gte('created_at', startOfMonth.toISOString()),
          ]);

        if (!active) return;

        const passRows = (
          !passesRes.error && Array.isArray(passesRes.data) ? passesRes.data : []
        ) as BulletinPostPassRow[];
        const availablePasses = passRows.filter(
          (p) => p.status === 'available' && !p.used_bulletin_id
        );
        const pendingPasses = passRows.filter(
          (p) => p.status === 'pending_verification'
        );

        const subRow = subRes.data as unknown as {
          expires_at?: string | null;
          subscription_plans?: SubscriptionPlanRow | SubscriptionPlanRow[] | null;
        } | null;

        const activePlan = Array.isArray(subRow?.subscription_plans)
          ? subRow?.subscription_plans[0] || null
          : subRow?.subscription_plans || null;

        const activeCount = activeCountRes.count ?? 0;
        const monthlyCount = monthlyCountRes.count ?? 0;

        // 1) Check active subscription with available quota first
        if (
          subRow &&
          activePlan &&
          activeCount < activePlan.max_active_bulletins &&
          monthlyCount < activePlan.max_monthly_posts
        ) {
          setQuota({
            status: 'eligible',
            isAdminBypass: false,
            usingPostPass: false,
            availablePassCount: availablePasses.length,
            pendingPassCount: pendingPasses.length,
            plan: activePlan,
            subscriptionExpiresAt: subRow.expires_at ?? null,
            activeCount,
            monthlyCount,
          });
          return;
        }

        // 2) Fallback: Check verified single post pass (available & unused)
        if (availablePasses.length > 0) {
          const passDuration = availablePasses[0].duration_days || 7;
          setExpiryDate(getDefaultExpiryDateString(passDuration));
          setQuota({
            status: 'eligible',
            isAdminBypass: false,
            usingPostPass: true,
            availablePassCount: availablePasses.length,
            passDurationDays: passDuration,
            pendingPassCount: pendingPasses.length,
            plan: activePlan,
            subscriptionExpiresAt: subRow?.expires_at ?? null,
            activeCount,
            monthlyCount,
          });
          return;
        }

        if (!subRow || !activePlan) {
          setQuota({
            status: 'unpaid',
            isAdminBypass: false,
            usingPostPass: false,
            availablePassCount: 0,
            pendingPassCount: pendingPasses.length,
            pendingUtrRef: pendingPasses[0]?.upi_utr_ref || null,
            plan: null,
            subscriptionExpiresAt: null,
            activeCount,
            monthlyCount,
            reason:
              'Publish with a one-off Single Post Pass (₹79 / 7 Days) or an active monthly Publisher Plan.',
          });
          return;
        }

        if (activeCount >= activePlan.max_active_bulletins) {
          setQuota({
            status: 'quota_reached',
            isAdminBypass: false,
            usingPostPass: false,
            availablePassCount: 0,
            pendingPassCount: pendingPasses.length,
            pendingUtrRef: pendingPasses[0]?.upi_utr_ref || null,
            plan: activePlan,
            subscriptionExpiresAt: subRow.expires_at ?? null,
            activeCount,
            monthlyCount,
            reason: `Active bulletin limit reached (${activeCount} of ${activePlan.max_active_bulletins} active slots used on your ${activePlan.name} plan). You can purchase a Single Post Pass below for an immediate extra post.`,
          });
          return;
        }

        setQuota({
          status: 'quota_reached',
          isAdminBypass: false,
          usingPostPass: false,
          availablePassCount: 0,
          pendingPassCount: pendingPasses.length,
          pendingUtrRef: pendingPasses[0]?.upi_utr_ref || null,
          plan: activePlan,
          subscriptionExpiresAt: subRow.expires_at ?? null,
          activeCount,
          monthlyCount,
          reason: `Monthly posting quota reached (${monthlyCount} of ${activePlan.max_monthly_posts} posts used this month on your ${activePlan.name} plan). You can purchase a Single Post Pass below for an extra post.`,
        });
      } catch {
        if (active) {
          setQuota({
            status: 'unpaid',
            isAdminBypass: false,
            plan: null,
            subscriptionExpiresAt: null,
            activeCount: 0,
            monthlyCount: 0,
            reason: 'Unable to verify active subscription status right now.',
          });
        }
      }
    }

    queueMicrotask(() => {
      if (active) void evaluateEligibility();
    });

    return () => {
      active = false;
    };
  }, [open, authUser?.id, syncedAuthRole, eligibilityNonce]);

  const listingSelectOptions = useMemo<CustomSelectOption[]>(() => {
    const opts: CustomSelectOption[] = [
      {
        value: '',
        label: 'No linked listing',
        description: 'Publish as a standalone community bulletin',
      },
    ];
    for (const item of ownedListings) {
      opts.push({
        value: item.id,
        label: item.title,
        description: item.locality || 'Churachandpur',
      });
    }
    return opts;
  }, [ownedListings]);

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !authUser?.id) return;
    setFormError(null);

    const remainingSlots = Math.max(0, maxImagesAllowed - imageUrls.length);
    if (remainingSlots <= 0) {
      setFormError(
        `Image limit reached: up to ${maxImagesAllowed} images allowed per bulletin.`
      );
      return;
    }

    const toUpload = Array.from(files).slice(0, remainingSlots);
    setIsUploadingImage(true);
    setStatus('uploading', 'Uploading images');

    try {
      const uploadedUrls: string[] = [];
      for (const file of toUpload) {
        const res = await uploadImage(file, {
          folder: 'bulletins',
          entityId: authUser.id,
        });
        if (res.publicUrl) {
          uploadedUrls.push(res.publicUrl);
        }
      }
      setImageUrls((prev) => [...prev, ...uploadedUrls].slice(0, maxImagesAllowed));
      setStatus('success', 'Images uploaded');
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to upload image attachment.'
      );
      setStatus('error', 'Upload failed');
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser?.id || isSubmitting) return;
    setFormError(null);

    const trimmedTitle = title.trim();
    const cleanText = plainText.trim().replace(/\s+/g, ' ');
    if (trimmedTitle.length < 5) {
      setFormError('Please enter a clear title (at least 5 characters).');
      return;
    }
    if (cleanText.length < 10) {
      setFormError('Please write bulletin details in the editor (at least 10 characters).');
      return;
    }
    if (imageUrls.length > maxImagesAllowed) {
      setFormError(`Your plan allows at most ${maxImagesAllowed} images per bulletin.`);
      return;
    }
    if (youtubeUrlInput.trim() && !parsedYouTubeId) {
      setFormError('Invalid YouTube URL or 11-character video ID.');
      return;
    }
    if (parsedYouTubeId && !allowYoutube) {
      setFormError('YouTube embeds are not enabled on your current plan.');
      return;
    }

    const contactChannels: Record<string, string> = {};
    if (contactPhone.trim()) contactChannels.phone = contactPhone.trim();
    if (contactWhatsapp.trim()) contactChannels.whatsapp = contactWhatsapp.trim();
    if (contactEmail.trim()) contactChannels.email = contactEmail.trim();
    if (contactWebsite.trim()) {
      const safeSite = sanitizeBulletinHref(
        /^https?:\/\//i.test(contactWebsite.trim())
          ? contactWebsite.trim()
          : `https://${contactWebsite.trim()}`
      );
      if (!safeSite) {
        setFormError('Website link must be a valid http:// or https:// URL.');
        return;
      }
      contactChannels.website = safeSite;
    }

    if (Object.keys(contactChannels).length === 0) {
      setFormError(
        'Provide at least one external response contact (Phone, WhatsApp, Email, or Website).'
      );
      return;
    }

    const excerpt =
      cleanText.length > 220 ? `${cleanText.slice(0, 217).trimEnd()}...` : cleanText;

    const expiresAtIso = expiryDate
      ? new Date(`${expiryDate}T23:59:59`).toISOString()
      : new Date(Date.now() + 14 * 86400000).toISOString();

    setIsSubmitting(true);
    setStatus('saving', 'Publishing bulletin');

    try {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured in this environment.');
      }

      const { error } = await supabase.from('bulletins').insert({
        author_id: authUser.id,
        linked_listing_id: linkedListingId || null,
        category,
        title: trimmedTitle,
        content_json: contentJson,
        excerpt,
        image_urls: imageUrls,
        youtube_video_id: parsedYouTubeId || null,
        contact_channels: contactChannels,
        status: 'published',
        expires_at: expiresAtIso,
      });

      if (error) {
        // Surface PostgreSQL quota trigger exceptions cleanly inline
        throw new Error(error.message || 'Unable to publish bulletin.');
      }

      setStatus('success', 'Bulletin published');
      resetForm();
      onPublished();
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Failed to publish bulletin. Please check your quota and fields.'
      );
      setStatus('error', 'Publish failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyUpi = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(PLATFORM_UPI_ID);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 1800);
    }
  };

  const handleSubmitPostPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser?.id || isSubmittingPass) return;
    const cleanUtr = passUtrInput.trim();
    if (cleanUtr.length < 6) {
      setPassFeedback({
        type: 'error',
        text: 'Please enter a valid 12-digit UPI UTR / transaction reference.',
      });
      return;
    }
    if (!isSupabaseConfigured()) {
      setPassFeedback({
        type: 'error',
        text: 'Supabase is not configured in this environment.',
      });
      return;
    }

    setIsSubmittingPass(true);
    setPassFeedback(null);
    setStatus('saving', 'Submitting UTR reference');

    try {
      const { error } = await supabase.from('bulletin_post_passes').insert({
        user_id: authUser.id,
        price_inr: payPerPostConfig.price_inr,
        duration_days: payPerPostConfig.duration_days,
        upi_utr_ref: cleanUtr,
        status: 'pending_verification',
      });

      if (error) {
        throw new Error(error.message || 'Could not submit UTR for verification.');
      }

      setPassUtrInput('');
      setPassFeedback({
        type: 'success',
        text: `UTR "${cleanUtr}" submitted! An admin will verify your ₹${payPerPostConfig.price_inr} pass shortly and unlock posting automatically.`,
      });
      setStatus('success', 'Pass UTR submitted');
      setEligibilityNonce((n) => n + 1);
    } catch (err) {
      setPassFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to submit Single Post Pass UTR.',
      });
      setStatus('error', 'UTR submission failed');
    } finally {
      setIsSubmittingPass(false);
    }
  };

  const whatsappActivationHref = useMemo(() => {
    const userLabel = fullName || authUser?.email || 'PrintSwift User';
    const text = encodeURIComponent(
      `Hi PrintSwift Local Admin, I would like to activate a Community Bulletin Publisher Plan for my account (${userLabel} / ${authUser?.email || 'registered user'}). Please share UPI payment instructions.`
    );
    return `https://wa.me/919862011223?text=${text}`;
  }, [fullName, authUser?.email]);

  const activeSlotsLeft = quota.plan
    ? Math.max(0, quota.plan.max_active_bulletins - quota.activeCount)
    : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="bulletin-composer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => {
            if (!isSubmitting) {
              clearStatus();
              onClose();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulletin-composer-title"
          data-testid="bulletin-composer-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
        >
          <motion.div
            key="bulletin-composer-panel"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
          >
            {/* Header */}
            <div className="px-4 sm:px-5 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2
                  id="bulletin-composer-title"
                  className="text-base font-bold tracking-tight text-[var(--ps-text)]"
                >
                  Post Community Bulletin
                </h2>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Verified publisher announcements, jobs, notices, and promotions
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                aria-label="Close composer"
                data-testid="bulletin-composer-close-btn"
                className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
              {quota.status === 'loading' ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--ps-accent)]" />
                  <span>Checking publisher subscription &amp; quota...</span>
                </div>
              ) : quota.status === 'unauthenticated' ? (
                <div className="py-8 text-center space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-accent)] mx-auto">
                    <Crown className="w-5 h-5" />
                  </div>
                  <div className="space-y-1 max-w-md mx-auto">
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Sign In Required to Post Bulletins
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                      Sign in with your PrintSwift Local account to check your publisher subscription plan or submit a new bulletin.
                    </p>
                  </div>
                  <div className="flex justify-center gap-2 pt-1">
                    <Link
                      href="/login"
                      onClick={onClose}
                      className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center justify-center"
                    >
                      Sign In
                    </Link>
                  </div>
                </div>
              ) : quota.status === 'unpaid' || quota.status === 'quota_reached' ? (
                /* Subscription Status & Available Plans Card */
                <div
                  data-testid="bulletin-subscription-gate"
                  className="space-y-4"
                >
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
                    <Crown className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1">
                      <p className="font-bold">
                        {quota.status === 'quota_reached'
                          ? 'Plan Quota Reached'
                          : 'Choose Single Post Pass or Monthly Plan'}
                      </p>
                      <p className="leading-relaxed opacity-90">
                        {quota.reason ||
                          'To prevent spam and guarantee verified local accountability, posting on the Churachandpur Community Bulletin requires a verified Single Post Pass or an active monthly subscription.'}
                      </p>
                    </div>
                  </div>

                  {/* Single Post Pass (Pay-Per-Post Manual UPI) Card */}
                  <div
                    data-testid="bulletin-pay-per-post-card"
                    className="rounded-xl border-2 border-[var(--ps-accent)]/50 bg-[var(--ps-surface-alt)]/40 p-3.5 sm:p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] flex items-center justify-center shrink-0">
                          <Ticket className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-bold text-[var(--ps-text)]">
                            Single Post Pass — ₹{payPerPostConfig.price_inr} ·{' '}
                            {payPerPostConfig.duration_days} Days
                          </h3>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            No recurring commitment. Pay once via UPI, enter UTR, and publish after quick admin check.
                          </p>
                        </div>
                      </div>
                      <span className="text-lg font-extrabold tabular-nums text-[var(--ps-text)]">
                        ₹{payPerPostConfig.price_inr}
                      </span>
                    </div>

                    {/* Copyable UPI ID row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] block">
                          Manual UPI ID
                        </span>
                        <span className="font-mono font-bold text-[var(--ps-text)]">
                          {PLATFORM_UPI_ID}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyUpi}
                        className="h-7 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] inline-flex items-center gap-1"
                      >
                        {copiedUpi ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy UPI</span>
                          </>
                        )}
                      </button>
                    </div>

                    {(quota.pendingPassCount ?? 0) > 0 && (
                      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] font-medium text-sky-800 dark:text-sky-200 flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          You have {quota.pendingPassCount} pass request
                          {(quota.pendingPassCount ?? 0) > 1 ? 's' : ''} awaiting admin UTR verification
                          {quota.pendingUtrRef ? ` (Ref: ${quota.pendingUtrRef})` : ''}.
                        </span>
                      </div>
                    )}

                    {passFeedback && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-[11px] font-semibold flex items-start gap-1.5 ${
                          passFeedback.type === 'success'
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {passFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        )}
                        <span>{passFeedback.text}</span>
                      </div>
                    )}

                    <form
                      onSubmit={(e) => void handleSubmitPostPass(e)}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={passUtrInput}
                        onChange={(e) => setPassUtrInput(e.target.value)}
                        placeholder="Enter 12-digit UPI UTR reference..."
                        data-testid="bulletin-pass-utr-input"
                        className="flex-1 h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-mono text-xs text-[var(--ps-text)] placeholder:font-sans placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingPass || passUtrInput.trim().length < 6}
                        data-testid="bulletin-pass-submit-btn"
                        className="h-9 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity disabled:opacity-50 shrink-0"
                      >
                        {isSubmittingPass ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Submitting...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Submit UTR for Verification</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>

                  {/* Monthly Subscription Plans Header */}
                  <div className="pt-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Or Choose a Monthly Publisher Plan
                    </p>
                  </div>

                  {/* Available Plans Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {plans.map((plan) => {
                      const isCurrent = quota.plan?.id === plan.id;
                      return (
                        <div
                          key={plan.id}
                          className={`rounded-xl border p-3.5 flex flex-col justify-between gap-2.5 ${
                            plan.slug === 'business'
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]/50'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-[var(--ps-text)]">
                                {plan.name}
                              </span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold uppercase">
                                  Current
                                </span>
                              )}
                            </div>
                            <div className="text-lg font-extrabold tabular-nums text-[var(--ps-text)]">
                              ₹{plan.price_inr}
                              <span className="text-[11px] font-medium text-[var(--ps-text-muted)]">
                                /{plan.duration_days}d
                              </span>
                            </div>
                          </div>

                          <ul className="space-y-1 text-[11px] text-[var(--ps-text-muted)]">
                            <li className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>{plan.max_active_bulletins} active bulletins</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>{plan.max_monthly_posts} posts / month</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span>Up to {plan.max_images_per_post} images / post</span>
                            </li>
                            {plan.allow_youtube && (
                              <li className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span>YouTube embeds included</span>
                              </li>
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </div>

                  {/* Manual UPI / Admin Activation CTA */}
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-[var(--ps-text-muted)]">
                      <span className="font-bold text-[var(--ps-text)] block">
                        Quick Manual UPI Activation
                      </span>
                      Message our Lamka desk with your email &amp; chosen plan for instant manual activation.
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <a
                        href={whatsappActivationHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="bulletin-request-activation-btn"
                        className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>Request Activation via WhatsApp / Admin</span>
                      </a>
                      <Link
                        href="/contact"
                        onClick={onClose}
                        className="h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center hover:bg-[var(--ps-surface-alt)] transition-colors"
                      >
                        Contact Desk
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                /* Eligible Publisher Composer Form */
                <form
                  id="bulletin-composer-form"
                  onSubmit={(e) => void handlePublish(e)}
                  className="space-y-4"
                >
                  {/* Remaining Quota Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 px-3 py-2 text-xs">
                    {quota.isAdminBypass ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-300">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span>Admin Access — Unlimited Quota</span>
                      </span>
                    ) : quota.usingPostPass ? (
                      <span
                        data-testid="bulletin-post-pass-ready-badge"
                        className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300"
                      >
                        <Ticket className="w-4 h-4 shrink-0" />
                        <span>
                          {quota.availablePassCount || 1} Verified Post Pass Ready (
                          {quota.passDurationDays || 7} Days)
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                        <Sparkles className="w-4 h-4 shrink-0" />
                        <span>
                          {quota.plan?.name} Plan: {activeSlotsLeft} of{' '}
                          {quota.plan?.max_active_bulletins} active slots left
                        </span>
                      </span>
                    )}
                    {!quota.isAdminBypass && !quota.usingPostPass && quota.plan && (
                      <span className="text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                        {quota.monthlyCount}/{quota.plan.max_monthly_posts} posted this month
                      </span>
                    )}
                    {quota.usingPostPass && (
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        Consumes 1 pass on publish
                      </span>
                    )}
                  </div>

                  {formError && (
                    <div
                      role="alert"
                      data-testid="bulletin-composer-error"
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-2"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{formError}</span>
                    </div>
                  )}

                  {/* Row 1: Category (CustomSelectModal) + Expiry Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CustomSelectModal
                      label="Category"
                      id="bulletin-category-select"
                      testId="bulletin-category-select"
                      options={CATEGORY_SELECT_OPTIONS}
                      value={category}
                      onChange={setCategory}
                      placeholder="Select category"
                    />

                    <div>
                      <label
                        htmlFor="bulletin-expiry-date"
                        className="block text-xs font-semibold text-[var(--ps-text)] mb-1.5"
                      >
                        Expiry Date (Default 14 days)
                      </label>
                      <div className="relative">
                        <Calendar
                          className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          id="bulletin-expiry-date"
                          type="date"
                          min={getTomorrowDateString()}
                          value={expiryDate}
                          onChange={(e) => setExpiryDate(e.target.value)}
                          className="w-full h-[44px] pl-9 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label
                      htmlFor="bulletin-title-input"
                      className="block text-xs font-semibold text-[var(--ps-text)] mb-1"
                    >
                      Headline / Title *
                    </label>
                    <input
                      id="bulletin-title-input"
                      type="text"
                      required
                      maxLength={140}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., Hiring: Graphic Designer in New Lamka"
                      data-testid="bulletin-title-input"
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                    />
                  </div>

                  {/* Rich-Text Tiptap Editor */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ps-text)] mb-1">
                      Details &amp; Announcement Body *
                    </label>
                    <BulletinEditor
                      onChange={(json, text) => {
                        setContentJson(json);
                        setPlainText(text);
                      }}
                      disabled={isSubmitting}
                    />
                  </div>

                  {/* Media: Supabase Storage Multi-Image Uploader */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-[var(--ps-text)]">
                        Images ({imageUrls.length} / {maxImagesAllowed})
                      </label>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={
                          isUploadingImage ||
                          imageUrls.length >= maxImagesAllowed ||
                          isSubmitting
                        }
                        className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {isUploadingImage ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                        )}
                        <span>Add Images</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => void handleUploadFiles(e.target.files)}
                      />
                    </div>

                    {imageUrls.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {imageUrls.map((url, idx) => (
                          <div
                            key={`${url}-${idx}`}
                            className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Attachment ${idx + 1}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setImageUrls((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              aria-label="Remove image"
                              className="absolute top-1 right-1 w-6 h-6 rounded-lg bg-black/70 text-white hover:bg-rose-600 inline-flex items-center justify-center"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* YouTube URL Input + Live Sandboxed Preview */}
                  {allowYoutube && (
                    <div className="space-y-2">
                      <label
                        htmlFor="bulletin-youtube-input"
                        className="block text-xs font-semibold text-[var(--ps-text)]"
                      >
                        YouTube Video URL (Optional)
                      </label>
                      <div className="relative">
                        <Play
                          className="w-4 h-4 text-rose-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          id="bulletin-youtube-input"
                          type="text"
                          value={youtubeUrlInput}
                          onChange={(e) => setYoutubeUrlInput(e.target.value)}
                          placeholder="https://youtu.be/... or https://youtube.com/watch?v=..."
                          className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                        />
                      </div>
                      {youtubeUrlInput.trim() && !parsedYouTubeId && (
                        <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          Could not detect a valid 11-character YouTube video ID yet.
                        </p>
                      )}
                      {parsedYouTubeId && (
                        <YouTubeEmbedPlayer
                          videoId={parsedYouTubeId}
                          title={title || 'YouTube preview'}
                        />
                      )}
                    </div>
                  )}

                  {/* External Response Contacts (at least 1 required) */}
                  <div className="space-y-2 pt-1 border-t border-[var(--ps-border)]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--ps-text)]">
                        External Response Contacts *
                      </span>
                      <span className="text-[10px] text-[var(--ps-text-muted)]">
                        At least one required
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="relative">
                        <Phone
                          className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="tel"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="Phone (+91 98620...)"
                          aria-label="Contact phone"
                          className="w-full h-9 pl-8 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                        />
                      </div>

                      <div className="relative">
                        <MessageCircle
                          className="w-3.5 h-3.5 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="tel"
                          value={contactWhatsapp}
                          onChange={(e) => setContactWhatsapp(e.target.value)}
                          placeholder="WhatsApp (+91 98620...)"
                          aria-label="Contact WhatsApp"
                          className="w-full h-9 pl-8 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                        />
                      </div>

                      <div className="relative">
                        <Mail
                          className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="Email (desk@example.com)"
                          aria-label="Contact email"
                          className="w-full h-9 pl-8 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                        />
                      </div>

                      <div className="relative">
                        <Globe
                          className="w-3.5 h-3.5 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          type="url"
                          value={contactWebsite}
                          onChange={(e) => setContactWebsite(e.target.value)}
                          placeholder="Website / Form URL (https://...)"
                          aria-label="Contact website"
                          className="w-full h-9 pl-8 pr-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Optional Linked Listing Selector (only if user owns listings) */}
                  {ownedListings.length > 0 && (
                    <CustomSelectModal
                      label="Attach Your Business / Property Listing (Optional)"
                      id="bulletin-linked-listing-select"
                      testId="bulletin-linked-listing-select"
                      options={listingSelectOptions}
                      value={linkedListingId}
                      onChange={setLinkedListingId}
                      placeholder="No linked listing"
                    />
                  )}
                </form>
              )}
            </div>

            {/* Footer Actions when Eligible */}
            {quota.status === 'eligible' && (
              <div className="px-4 sm:px-5 py-3 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/40 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="bulletin-composer-form"
                  disabled={isSubmitting || isUploadingImage}
                  data-testid="bulletin-publish-submit-btn"
                  className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Publishing...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Publish Bulletin</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default BulletinComposerModal;
