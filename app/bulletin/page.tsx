'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  BadgeCheck,
  Bookmark,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Flag,
  Globe,
  Image as ImageIcon,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  Phone,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { BulletinComposerModal } from '@/components/bulletin/BulletinComposerModal';
import {
  BulletinContentRenderer,
  YouTubeEmbedPlayer,
  isValidYouTubeVideoId,
  sanitizeBulletinHref,
  type TiptapDoc,
} from '@/components/bulletin/BulletinContentRenderer';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { PromoBannerSlot } from '@/components/ui/PromoBannerSlot';
import { useShare } from '@/components/ui/ShareSheetModal';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchHideSampleDataFlag,
  isSampleTitle,
} from '@/lib/supabase/platform-settings';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type { NestedCategoryNode } from '@/lib/config/types';
import {
  buildContextualWhatsAppUrl,
  normalizeWhatsAppPhone,
} from '@/lib/utils/whatsapp';
import { attachPublicAuthorProfiles } from '@/lib/supabase/public-profiles';

type BulletinCategory =
  | 'announcement'
  | 'job'
  | 'advertisement'
  | 'notice'
  | 'event';

interface ContactChannels {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
}

interface BulletinAuthor {
  id: string;
  full_name?: string | null;
  name?: string | null;
  role?: string | null;
  avatar_url?: string | null;
}

interface LinkedListingRef {
  id: string;
  title?: string | null;
  locality?: string | null;
}

interface BulletinSummary {
  id: string;
  author_id: string;
  linked_listing_id: string | null;
  category: BulletinCategory;
  category_id?: string | null;
  custom_tags?: string[];
  hub_id?: string | null;
  target_hub_ids?: string[];
  is_global?: boolean;
  title: string;
  excerpt: string;
  image_urls: string[];
  youtube_video_id: string | null;
  is_pinned: boolean;
  is_verified?: boolean;
  expires_at: string | null;
  paid_until?: string | null;
  created_at: string;
  authorName: string;
  authorRole: string;
  authorAvatarUrl: string | null;
  content_json?: TiptapDoc | null;
  contact_channels?: ContactChannels | null;
  linkedListing?: LinkedListingRef | null;
}

interface RawBulletinRow {
  id: string;
  author_id: string;
  linked_listing_id?: string | null;
  category: BulletinCategory;
  category_id?: string | null;
  custom_tags?: string[] | null;
  hub_id?: string | null;
  target_hub_ids?: string[] | null;
  is_global?: boolean | null;
  title: string;
  excerpt?: string | null;
  image_urls?: string[] | null;
  youtube_video_id?: string | null;
  is_pinned?: boolean | null;
  is_verified?: boolean | null;
  expires_at?: string | null;
  paid_until?: string | null;
  created_at: string;
  content_json?: TiptapDoc | null;
  contact_channels?: ContactChannels | null;
  profiles?: BulletinAuthor | BulletinAuthor[] | null;
  listings?: LinkedListingRef | LinkedListingRef[] | null;
}

const PAGE_SIZE = 15;

const CATEGORY_OPTIONS: Array<{
  id: 'all' | BulletinCategory;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'announcement', label: 'Announcement' },
  { id: 'job', label: 'Job' },
  { id: 'advertisement', label: 'Advertisement' },
  { id: 'notice', label: 'Notice' },
  { id: 'event', label: 'Event' },
];

const CATEGORY_META: Record<
  BulletinCategory,
  {
    label: string;
    badgeClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  announcement: {
    label: 'Announcement',
    badgeClass:
      'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25',
    icon: Megaphone,
  },
  job: {
    label: 'Job',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    icon: Briefcase,
  },
  advertisement: {
    label: 'Advertisement',
    badgeClass:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    icon: Sparkles,
  },
  notice: {
    label: 'Notice',
    badgeClass:
      'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25',
    icon: Newspaper,
  },
  event: {
    label: 'Event',
    badgeClass:
      'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
    icon: Calendar,
  },
};

const REPORT_REASONS = [
  'Misleading or inaccurate information',
  'Spam, scam, or duplicate advertisement',
  'Expired offer or closed job opening',
  'Inappropriate or abusive content',
];

const FALLBACK_BULLETINS: BulletinSummary[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    author_id: 'admin-super',
    linked_listing_id: null,
    category: 'announcement',
    title: 'Lamka Main Road Drainage Maintenance & Morning Traffic Advisory',
    excerpt:
      'Scheduled morning storm-drain clearing along Tedim Road (New Bazaar to Tuibong Junction) between 6:00 AM and 10:30 AM. Please plan alternate routes.',
    image_urls: [],
    youtube_video_id: null,
    is_pinned: true,
    expires_at: new Date(Date.now() + 45 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    authorName: 'DD oodle Civic Desk',
    authorRole: 'super_admin',
    authorAvatarUrl: null,
    content_json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Public Works and local ward committees will carry out scheduled storm-drain clearing along ',
            },
            {
              type: 'text',
              text: 'Tedim Road (New Bazaar to Tuibong Junction)',
              marks: [{ type: 'bold' }],
            },
            {
              type: 'text',
              text: ' from 6:00 AM to 10:30 AM this week.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Commuter Guidelines' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Heavy commercial vehicles are advised to use the Pearsonmun bypass during morning clearing hours.',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Shopkeepers along Main Road are requested to keep curbside parking clear before 6:00 AM.',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Emergency ambulances and school buses retain priority passage throughout.',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'For urgent civic queries or blocked culvert reporting, reach the district coordination desk directly using the contact options below.',
                },
              ],
            },
          ],
        },
      ],
    },
    contact_channels: {
      phone: '+919862011223',
      email: 'desk@ddoodle.in',
      website: 'https://churachandpur.nic.in',
    },
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    author_id: 'owner-1',
    linked_listing_id: null,
    category: 'job',
    title: 'Hiring: Full-Time Graphic Designer & Large-Format Print Operator',
    excerpt:
      'Immediate full-time opening in New Lamka for a CorelDRAW/Photoshop designer & flex print operator. Competitive local salary ₹14,000–₹20,000/mo.',
    image_urls: [],
    youtube_video_id: null,
    is_pinned: false,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 8 * 3600000).toISOString(),
    authorName: 'Lamka Print & Media Hub',
    authorRole: 'owner',
    authorAvatarUrl: null,
    content_json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'We are expanding our production desk in ',
            },
            {
              type: 'text',
              text: 'New Lamka, Churachandpur',
              marks: [{ type: 'bold' }],
            },
            {
              type: 'text',
              text: ' and looking for a reliable, detail-oriented designer and print operator to join immediately.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Key Responsibilities & Requirements' }],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Proficiency in CorelDRAW, Adobe Photoshop, or Illustrator for flex banners, invitations, and signage.',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Ability to prepare CMYK print-ready files and manage walk-in revisions calmly.',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Fluent in English and Paite/Thadou-Kuki/Hmar or Meitei.',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Compensation: ', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: '₹14,000 – ₹20,000/month based on portfolio and machine experience. Send your CV via WhatsApp or Email.',
            },
          ],
        },
      ],
    },
    contact_channels: {
      phone: '+919862044556',
      whatsapp: '+919862044556',
      email: 'careers@ddoodle.in',
    },
  },
  {
    id: 'b0000000-0000-4000-8000-000000000003',
    author_id: 'owner-2',
    linked_listing_id: null,
    category: 'advertisement',
    title: 'Highland Solar & Inverter Clearance — Up to 20% Off Home Backup Kits',
    excerpt:
      'Seasonal clearance on lithium solar home backup systems with free rooftop inspection and 5-year local warranty across Churachandpur.',
    image_urls: [],
    youtube_video_id: 'M7lc1UVf-VE',
    is_pinned: false,
    expires_at: new Date(Date.now() + 25 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    authorName: 'Highland Solar Systems',
    authorRole: 'owner',
    authorAvatarUrl: null,
    content_json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Prepare for monsoon power outages with certified ',
            },
            {
              type: 'text',
              text: 'LiFePO4 solar inverter batteries and mono-PERC panels',
              marks: [{ type: 'bold' }],
            },
            {
              type: 'text',
              text: ' with same-week installation across Lamka, Rengkai, Tuibong, and Zenhang Lamka.',
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Free rooftop site survey within 10 km of Churachandpur town centre.',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: '5-year on-site warranty with direct local technician support.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    contact_channels: {
      phone: '+919862077889',
      whatsapp: '+919862077889',
      website: 'https://ddoodle.in',
    },
  },
  {
    id: 'b0000000-0000-4000-8000-000000000004',
    author_id: 'admin-super',
    linked_listing_id: null,
    category: 'notice',
    title: 'Voluntary Blood Donation Camp & Free General Health Checkup — Rengkai',
    excerpt:
      'Join the Saturday morning voluntary blood donation drive and free BP/blood-sugar screening at Rengkai Community Hall (9:00 AM – 2:30 PM).',
    image_urls: [],
    youtube_video_id: null,
    is_pinned: false,
    expires_at: new Date(Date.now() + 20 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 52 * 3600000).toISOString(),
    authorName: 'Rengkai Youth Health Collective',
    authorRole: 'admin',
    authorAvatarUrl: null,
    content_json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Local youth volunteers in partnership with District Hospital Blood Bank are organizing a ',
            },
            {
              type: 'text',
              text: 'Voluntary Blood Donation Camp & Free BP/Sugar Screening',
              marks: [{ type: 'bold' }],
            },
            {
              type: 'text',
              text: ' at Rengkai Community Hall this Saturday from 9:00 AM to 2:30 PM.',
            },
          ],
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Every single unit donated directly strengthens emergency reserves for Churachandpur District Hospital. Refreshments and donor certificates will be provided.',
                },
              ],
            },
          ],
        },
      ],
    },
    contact_channels: {
      phone: '+919862099100',
      whatsapp: '+919862099100',
    },
  },
];

function formatRelativeTime(isoDate: string): string {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function formatExpiryDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function normalizeBulletinRow(row: RawBulletinRow): BulletinSummary {
  const authorObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const listingObj = Array.isArray(row.listings) ? row.listings[0] : row.listings;

  return {
    id: row.id,
    author_id: row.author_id,
    linked_listing_id: row.linked_listing_id ?? null,
    category: row.category,
    category_id: row.category_id ?? null,
    custom_tags: Array.isArray(row.custom_tags)
      ? row.custom_tags.map((t) => String(t).trim()).filter(Boolean)
      : [],
    hub_id: row.hub_id ?? null,
    target_hub_ids: Array.isArray(row.target_hub_ids)
      ? row.target_hub_ids.map((id) => String(id).trim()).filter(Boolean)
      : [],
    is_global: Boolean(row.is_global),
    title: row.title,
    excerpt: row.excerpt?.trim() || '',
    image_urls: Array.isArray(row.image_urls)
      ? row.image_urls.filter((u) => typeof u === 'string' && u.trim().length > 0)
      : [],
    youtube_video_id: isValidYouTubeVideoId(row.youtube_video_id)
      ? row.youtube_video_id
      : null,
    is_pinned: Boolean(row.is_pinned),
    is_verified: Boolean(row.is_verified),
    expires_at: row.expires_at ?? null,
    paid_until: row.paid_until ?? null,
    created_at: row.created_at,
    authorName:
      authorObj?.full_name?.trim() ||
      authorObj?.name?.trim() ||
      'Verified Publisher',
    authorRole: (authorObj?.role || 'subscriber').toLowerCase(),
    authorAvatarUrl: authorObj?.avatar_url?.trim() || null,
    content_json: row.content_json ?? null,
    contact_channels: row.contact_channels ?? null,
    linkedListing: listingObj ?? null,
  };
}

function getRoleBadgeMeta(role: string): {
  label: string;
  isAdmin: boolean;
} {
  const normalized = role.toLowerCase();
  if (normalized === 'super_admin' || normalized === 'admin') {
    return { label: 'Official Admin', isAdmin: true };
  }
  if (normalized === 'owner') {
    return { label: 'Verified Business', isAdmin: false };
  }
  return { label: 'Verified Subscriber', isAdmin: false };
}

function buildWhatsAppHref(
  rawPhone: string,
  bulletinTitle: string,
  hubName?: string | null
): string | null {
  const digits = normalizeWhatsAppPhone(rawPhone);
  if (!digits) return null;
  return buildContextualWhatsAppUrl(digits, {
    type: 'listing_enquiry',
    listingTitle: bulletinTitle,
    hub: hubName || null,
    url:
      typeof window !== 'undefined' ? window.location.href : null,
    customNote: 'Reaching out regarding your community bulletin on DD oodle.',
  });
}

export default function BulletinPage() {
  const { setStatus, clearStatus } = useAppStatus();
  const { share } = useShare();
  const { user: authUser } = useAuth();
  const { isSaved, toggleSave, isFollowing, toggleFollow } = useSavedInterests();
  const {
    activeHub,
    categories: appConfigCategories,
    categoriesByEntity,
    getCategorySubtreeSlugsOrIds,
  } = useAppConfig();

  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';

  const [bulletins, setBulletins] = useState<BulletinSummary[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>('all');

  const bulletinRootNodes = useMemo<NestedCategoryNode[]>(
    () => categoriesByEntity?.bulletin || [],
    [categoriesByEntity]
  );

  const categoryFilterOptions = useMemo(() => {
    if (bulletinRootNodes.length > 0) {
      return [
        { id: 'all', label: 'All' },
        ...bulletinRootNodes.map((node) => ({
          id: node.slug.toLowerCase(),
          label: node.display_name,
        })),
      ];
    }
    const dynamicCats = appConfigCategories
      .filter((c) => c.module === 'bulletin' && c.is_active && c.slug.trim())
      .map((c) => ({
        id: c.slug.trim().toLowerCase(),
        label: c.display_name.trim() || c.slug.trim(),
      }));
    if (dynamicCats.length === 0) {
      return CATEGORY_OPTIONS;
    }
    return [{ id: 'all', label: 'All' }, ...dynamicCats];
  }, [bulletinRootNodes, appConfigCategories]);

  const activeRootBulletinNode = useMemo<NestedCategoryNode | null>(() => {
    if (selectedCategory === 'all') return null;
    const target = selectedCategory.toLowerCase();
    return (
      bulletinRootNodes.find(
        (n) =>
          n.slug.toLowerCase() === target ||
          n.display_name.toLowerCase() === target ||
          n.id === selectedCategory
      ) || null
    );
  }, [bulletinRootNodes, selectedCategory]);

  const bulletinSubcategoryChips = useMemo(() => {
    if (!activeRootBulletinNode || activeRootBulletinNode.children.length === 0) {
      return [];
    }
    const chips: Array<{ id: string; slug: string; label: string }> = [];
    for (const child of activeRootBulletinNode.children) {
      chips.push({ id: child.id, slug: child.slug, label: child.display_name });
      for (const grandChild of child.children) {
        chips.push({
          id: grandChild.id,
          slug: grandChild.slug,
          label: `${child.display_name} › ${grandChild.display_name}`,
        });
      }
    }
    return chips;
  }, [activeRootBulletinNode]);

  const activeBulletinSubtreeSet = useMemo(() => {
    if (selectedCategory === 'all') return null;
    const targetIdentifier =
      selectedSubcategoryId !== 'all'
        ? selectedSubcategoryId
        : activeRootBulletinNode?.id || selectedCategory;
    const subtree = getCategorySubtreeSlugsOrIds(targetIdentifier, 'bulletin');
    const normalized = new Set<string>([...subtree.ids, ...subtree.slugs].map((val) => val.toLowerCase()));
    if (selectedSubcategoryId === 'all') {
      normalized.add(selectedCategory.toLowerCase());
      if (activeRootBulletinNode) {
        normalized.add(activeRootBulletinNode.slug.toLowerCase());
        normalized.add(activeRootBulletinNode.display_name.toLowerCase());
      }
    } else {
      const chip = bulletinSubcategoryChips.find((c) => c.id === selectedSubcategoryId);
      if (chip) {
        normalized.add(chip.slug.toLowerCase());
        normalized.add(chip.label.toLowerCase());
      }
    }
    return normalized;
  }, [
    selectedCategory,
    selectedSubcategoryId,
    activeRootBulletinNode,
    bulletinSubcategoryChips,
    getCategorySubtreeSlugsOrIds,
  ]);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usingFallbackData, setUsingFallbackData] = useState(false);

  // Composer / Plans Modal state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerInitialMode, setComposerInitialMode] = useState<'compose' | 'plans'>('compose');

  // Detail Modal state
  const [activeBulletin, setActiveBulletin] = useState<BulletinSummary | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Report state inside detail modal
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Hydrate initial ?category=, ?q=, ?plans=1, and ?compose=1 URL params on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const catParam = (params.get('category') || '').trim().toLowerCase();
    const qParam = (params.get('q') || '').trim();
    const plansParam = (params.get('plans') || '').trim().toLowerCase();
    const composeParam = (params.get('compose') || '').trim().toLowerCase();
    queueMicrotask(() => {
      if (catParam && catParam !== 'all') {
        setSelectedCategory(catParam);
      }
      if (qParam) {
        setSearchInput(qParam);
        setDebouncedSearch(qParam);
      }
      if (plansParam === '1' || plansParam === 'true') {
        setComposerInitialMode('plans');
        setIsComposerOpen(true);
      } else if (composeParam === '1' || composeParam === 'true') {
        setComposerInitialMode('compose');
        setIsComposerOpen(true);
      }
    });
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Close modal on Escape
  useEffect(() => {
    if (!activeBulletin) return;
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (previewImageUrl) {
          setPreviewImageUrl(null);
        } else {
          setActiveBulletin(null);
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeBulletin, previewImageUrl]);

  const matchesBulletinClientFilters = useCallback(
    (item: BulletinSummary) => {
      if (activeHubId && !activeHubId.startsWith('fallback-')) {
        const isGlobal = Boolean(item.is_global);
        const inTargetHubs =
          Array.isArray(item.target_hub_ids) &&
          item.target_hub_ids.includes(activeHubId);
        const matchesHubId = !item.hub_id || item.hub_id === activeHubId;
        if (!isGlobal && !inTargetHubs && !matchesHubId) {
          return false;
        }
      }

      if (activeBulletinSubtreeSet) {
        const catLower = (item.category || '').toLowerCase();
        const catIdLower = (item.category_id || '').toLowerCase();
        const tags = Array.isArray(item.custom_tags) ? item.custom_tags : [];
        const tagMatch = tags.some((t) =>
          activeBulletinSubtreeSet.has(t.toLowerCase())
        );
        const directMatch =
          (selectedSubcategoryId === 'all' && activeBulletinSubtreeSet.has(catLower)) ||
          (catIdLower && activeBulletinSubtreeSet.has(catIdLower));
        if (!directMatch && !tagMatch) {
          return false;
        }
      }

      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inExcerpt = item.excerpt.toLowerCase().includes(q);
        const inAuthor = item.authorName.toLowerCase().includes(q);
        const inTags = (item.custom_tags || []).some((t) =>
          t.toLowerCase().includes(q)
        );
        if (!inTitle && !inExcerpt && !inAuthor && !inTags) {
          return false;
        }
      }

      return true;
    },
    [activeHubId, activeBulletinSubtreeSet, selectedSubcategoryId, debouncedSearch]
  );

  const filterFallbackBulletins = useCallback(
    (nextOffset: number) => {
      const filtered = FALLBACK_BULLETINS.filter(matchesBulletinClientFilters);
      return {
        slice: filtered.slice(nextOffset, nextOffset + PAGE_SIZE),
        hasMoreItems: filtered.length > nextOffset + PAGE_SIZE,
      };
    },
    [matchesBulletinClientFilters]
  );

  const fetchBulletinsPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (append) {
        setIsLoadingMore(true);
        setStatus('loading_more', 'Loading more');
      } else {
        setIsInitialLoading(true);
        setStatus('fetching_listings', 'Loading bulletin');
      }
      setErrorMessage(null);

      try {
        const hideSampleData = await fetchHideSampleDataFlag();

        if (!isSupabaseConfigured()) {
          const { slice, hasMoreItems } = filterFallbackBulletins(nextOffset);
          const cleanSlice = hideSampleData
            ? slice.filter((b) => !isSampleTitle(b.title))
            : slice;
          setUsingFallbackData(true);
          setBulletins((prev) => (append ? [...prev, ...cleanSlice] : cleanSlice));
          setOffset(nextOffset);
          setHasMore(hasMoreItems);
          return;
        }

        const nowIso = new Date().toISOString();
        const runBulletinQuery = async (
          includeMultiHubCols: boolean,
          includeMonetizationCols: boolean
        ) => {
          const monetizationCols = includeMonetizationCols
            ? ', paid_until, is_verified'
            : '';
          const selectCols = includeMultiHubCols
            ? `id, author_id, linked_listing_id, category, category_id, custom_tags, hub_id, target_hub_ids, is_global, title, excerpt, image_urls, youtube_video_id, is_pinned, expires_at${monetizationCols}, created_at`
            : `id, author_id, linked_listing_id, category, title, excerpt, image_urls, youtube_video_id, is_pinned, expires_at${monetizationCols}, created_at`;

          let query = supabase
            .from('bulletins')
            .select(selectCols)
            .eq('status', 'published')
            .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false })
            .range(nextOffset, nextOffset + PAGE_SIZE * 2 - 1);

          if (includeMonetizationCols) {
            query = query.or(`paid_until.is.null,paid_until.gt.${nowIso}`);
          }

          if (includeMultiHubCols && activeHubId && !activeHubId.startsWith('fallback-')) {
            query = query.or(
              `is_global.eq.true,target_hub_ids.cs.{${activeHubId}},hub_id.eq.${activeHubId}`
            );
          }

          if (hideSampleData) {
            query = query.not('title', 'ilike', '[SAMPLE]%');
          }
          if (selectedCategory !== 'all') {
            query = query.eq('category', selectedCategory);
          }

          return query;
        };

        let { data, error } = await runBulletinQuery(true, true);
        if (
          error &&
          /(category_id|custom_tags|hub_id|target_hub_ids|is_global|paid_until|is_verified)/i.test(
            error.message || ''
          )
        ) {
          const hasMonetizationErr = /(paid_until|is_verified)/i.test(
            error.message || ''
          );
          const retry = await runBulletinQuery(false, !hasMonetizationErr);
          data = retry.data;
          error = retry.error;
        }

        // v21a (P0-16): author bylines come from the safe public_profiles view
        if (!error && Array.isArray(data)) {
          data = (await attachPublicAuthorProfiles(
            supabase,
            data as unknown as Array<Record<string, unknown>>
          )) as unknown as typeof data;
        }

        if (error) {
          // Graceful fallback if the Phase 59 migration hasn't been applied to the remote project yet
          if (
            /bulletins/i.test(error.message || '') ||
            error.code === '42P01' ||
            error.code === 'PGRST205'
          ) {
            const { slice, hasMoreItems } = filterFallbackBulletins(nextOffset);
            const cleanSlice = hideSampleData
              ? slice.filter((b) => !isSampleTitle(b.title))
              : slice;
            setUsingFallbackData(true);
            setBulletins((prev) => (append ? [...prev, ...cleanSlice] : cleanSlice));
            setOffset(nextOffset);
            setHasMore(hasMoreItems);
            return;
          }
          throw new Error(error.message || 'Unable to load community bulletins.');
        }

        setUsingFallbackData(false);
        const nowMs = Date.now();
        const rawRows = (data || []) as unknown as RawBulletinRow[];
        const mappedAll = rawRows.map(normalizeBulletinRow);
        const mapped = mappedAll
          .filter((b) => !(hideSampleData && isSampleTitle(b.title)))
          .filter((b) => {
            if (!b.paid_until) return true;
            const ts = new Date(b.paid_until).getTime();
            return !Number.isFinite(ts) || ts > nowMs;
          })
          .filter(matchesBulletinClientFilters);

        setBulletins((prev) => {
          if (!append) return mapped;
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...mapped.filter((item) => !seen.has(item.id))];
        });
        setOffset(nextOffset);
        setHasMore(rawRows.length >= PAGE_SIZE);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Failed to load community bulletin feed.'
        );
      } finally {
        setIsInitialLoading(false);
        setIsLoadingMore(false);
        clearStatus();
      }
    },
    [
      activeHubId,
      selectedCategory,
      filterFallbackBulletins,
      matchesBulletinClientFilters,
      setStatus,
      clearStatus,
    ]
  );

  // Defer initial fetch cleanly via queueMicrotask to satisfy react-hooks/set-state-in-effect
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void fetchBulletinsPage(0, false);
      }
    });
    const handleSettingsChanged = () => {
      if (active) void fetchBulletinsPage(0, false);
    };
    window.addEventListener(
      'printswift:platform-settings-updated',
      handleSettingsChanged
    );
    return () => {
      active = false;
      window.removeEventListener(
        'printswift:platform-settings-updated',
        handleSettingsChanged
      );
    };
  }, [fetchBulletinsPage]);

  const handleOpenDetail = async (item: BulletinSummary) => {
    setActiveBulletin(item);
    setIsReportOpen(false);
    setReportFeedback(null);
    setCustomReason('');
    setSelectedReason(REPORT_REASONS[0]);
    setPreviewImageUrl(null);

    // If full rich-text content is already present (e.g., cached or fallback), skip extra fetch
    if (item.content_json || usingFallbackData || !isSupabaseConfigured()) {
      setIsDetailLoading(false);
      return;
    }

    setIsDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from('bulletins')
        .select(
          'id, content_json, contact_channels, image_urls, youtube_video_id, linked_listing_id, listings:linked_listing_id(id, title, locality)'
        )
        .eq('id', item.id)
        .maybeSingle();

      if (!error && data) {
        const detailRow = data as unknown as {
          content_json?: TiptapDoc | null;
          contact_channels?: ContactChannels | null;
          image_urls?: string[] | null;
          youtube_video_id?: string | null;
          linked_listing_id?: string | null;
          listings?: LinkedListingRef | LinkedListingRef[] | null;
        };
        const listingObj = Array.isArray(detailRow.listings)
          ? detailRow.listings[0]
          : detailRow.listings;

        const hydrated: BulletinSummary = {
          ...item,
          content_json: detailRow.content_json ?? null,
          contact_channels: detailRow.contact_channels ?? {},
          image_urls: Array.isArray(detailRow.image_urls)
            ? detailRow.image_urls.filter((u) => typeof u === 'string' && u.trim().length > 0)
            : item.image_urls,
          youtube_video_id: isValidYouTubeVideoId(detailRow.youtube_video_id)
            ? detailRow.youtube_video_id
            : item.youtube_video_id,
          linked_listing_id: detailRow.linked_listing_id ?? item.linked_listing_id,
          linkedListing: listingObj ?? null,
        };

        setActiveBulletin((current) =>
          current && current.id === item.id ? hydrated : current
        );
        setBulletins((prev) =>
          prev.map((entry) => (entry.id === item.id ? hydrated : entry))
        );
      }
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBulletin || isSubmittingReport) return;

    if (!authUser?.id) {
      setReportFeedback({
        type: 'error',
        message: 'Please sign in to submit a community moderation report.',
      });
      return;
    }

    const finalReason = customReason.trim()
      ? `${selectedReason} — ${customReason.trim()}`
      : selectedReason;

    setIsSubmittingReport(true);
    setReportFeedback(null);
    setStatus('saving', 'Sending report');

    try {
      if (!isSupabaseConfigured() || usingFallbackData) {
        setReportFeedback({
          type: 'success',
          message: 'Report queued for moderation review.',
        });
        setStatus('success', 'Report sent');
        setCustomReason('');
        return;
      }

      const { error } = await supabase.from('bulletin_reports').insert({
        bulletin_id: activeBulletin.id,
        reporter_id: authUser.id,
        reason: finalReason,
      });

      if (error) {
        throw new Error(error.message || 'Could not submit report.');
      }

      setReportFeedback({
        type: 'success',
        message: 'Thank you. Moderators have been notified.',
      });
      setStatus('success', 'Report sent');
      setCustomReason('');
    } catch (err) {
      setReportFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to submit report right now.',
      });
      setStatus('error', 'Report failed');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const activeContacts = useMemo(() => {
    if (!activeBulletin?.contact_channels) return null;
    const raw = activeBulletin.contact_channels;
    const phone =
      typeof raw.phone === 'string' && raw.phone.trim()
        ? sanitizeBulletinHref(`tel:${raw.phone.trim().replace(/\s+/g, '')}`)
        : null;
    const whatsapp =
      typeof raw.whatsapp === 'string' && raw.whatsapp.trim()
        ? buildWhatsAppHref(raw.whatsapp.trim(), activeBulletin.title)
        : null;
    const email =
      typeof raw.email === 'string' && raw.email.trim()
        ? sanitizeBulletinHref(`mailto:${raw.email.trim()}`)
        : null;
    const website =
      typeof raw.website === 'string' && raw.website.trim()
        ? sanitizeBulletinHref(raw.website.trim())
        : null;

    if (!phone && !whatsapp && !email && !website) return null;
    return { phone, whatsapp, email, website };
  }, [activeBulletin]);

  return (
    <ModulePausedGuard module="bulletin">
    <div
      data-testid="bulletin-route-page"
      className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6 space-y-5 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Header + Dense Search & Category Pills */}
      <section className="space-y-3 border-b border-[var(--ps-border)] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)]">
              {activeHubName} Community Bulletin
            </h1>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
              Verified local notices, jobs, official advisories, and subscriber announcements across {activeHubName}.
            </p>
          </div>

          {/* Dense h-9 Search Bar + Refresh */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search
                className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search notices, jobs, events..."
                aria-label="Search community bulletins"
                data-testid="bulletin-search-input"
                className="w-full h-9 pl-9 pr-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="w-6 h-6 rounded-lg inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void fetchBulletinsPage(0, false)}
              disabled={isInitialLoading}
              aria-label="Refresh bulletin feed"
              title="Refresh feed"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw
                className={`w-4 h-4 ${isInitialLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
            <Link
              href="/bulletin?plans=1"
              onClick={(e) => {
                e.preventDefault();
                setComposerInitialMode('plans');
                setIsComposerOpen(true);
              }}
              data-testid="bulletin-plans-link"
              className="min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:border-[var(--ps-accent)]/50 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Plans &amp; Trials</span>
            </Link>
            <Link
              href={authUser ? '/workspace?hat=advertiser' : '/onboarding?track=advertiser'}
              data-testid="bulletin-advertiser-console-link"
              className="min-h-[44px] px-3 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-accent)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[var(--ps-accent)]/15 transition-colors whitespace-nowrap shrink-0"
            >
              <Megaphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">
                {authUser ? 'Advertiser Console' : 'Become Advertiser'}
              </span>
              <span className="sm:hidden">
                {authUser ? 'Console' : 'Advertise'}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setComposerInitialMode('compose');
                setIsComposerOpen(true);
              }}
              data-testid="bulletin-post-btn"
              className="min-h-[44px] px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 shadow-2xs cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Post Bulletin</span>
            </button>
          </div>
        </div>

        {/* Horizontal Category Filter Pills (44px touch targets) */}
        <div
          role="tablist"
          aria-label="Filter bulletins by category"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
        >
          {categoryFilterOptions.map((opt) => {
            const isActive = selectedCategory === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`bulletin-filter-${opt.id}`}
                onClick={() => {
                  setSelectedCategory(opt.id);
                  setSelectedSubcategoryId('all');
                }}
                className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors border cursor-pointer ${
                  isActive
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)] shadow-2xs'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Secondary Nested Subcategory Chip Strip (e.g. Job -> Full-Time / Part-Time / Govt / Contractual) */}
        {bulletinSubcategoryChips.length > 0 && (
          <div
            data-testid="bulletin-subcategory-strip"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1"
          >
            <button
              type="button"
              onClick={() => setSelectedSubcategoryId('all')}
              className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                selectedSubcategoryId === 'all'
                  ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                  : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              All {activeRootBulletinNode?.display_name || selectedCategory}
            </button>
            {bulletinSubcategoryChips.map((sub) => {
              const isSubActive = selectedSubcategoryId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() =>
                    setSelectedSubcategoryId(isSubActive ? 'all' : sub.id)
                  }
                  className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSubActive
                      ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <PromoBannerSlot placement="bulletin_top" compact />

      {/* Error State */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchBulletinsPage(0, false)}
            className="h-8 px-3 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton Grid */}
      {isInitialLoading ? (
        <div
          data-testid="bulletin-feed-skeleton"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="dd-shimmer h-5 w-24 rounded-md" />
                <div className="dd-shimmer h-4 w-20 rounded" />
              </div>
              <div className="dd-shimmer h-5 w-5/6 rounded" />
              <div className="space-y-1.5">
                <div className="dd-shimmer h-3.5 w-full rounded" />
                <div className="dd-shimmer h-3.5 w-4/5 rounded" />
              </div>
              <div className="pt-2 border-t border-[var(--ps-border)]/70 flex items-center justify-between">
                <div className="dd-shimmer h-4 w-32 rounded" />
                <div className="dd-shimmer h-3.5 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : bulletins.length === 0 ? (
        /* Empty State */
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-text-muted)] mx-auto">
            <Newspaper className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              No bulletins match your filters in {activeHubName}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Try clearing your search or switching back to All categories.
            </p>
          </div>
          {(selectedCategory !== 'all' || selectedSubcategoryId !== 'all' || searchInput) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedSubcategoryId('all');
                setSearchInput('');
              }}
              className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 transition-opacity"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        /* Live Bulletin Feed Grid */
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bulletins.map((item) => {
              const catMeta = CATEGORY_META[item.category] || CATEGORY_META.notice;
              const CatIcon = catMeta.icon;
              const roleMeta = getRoleBadgeMeta(item.authorRole);
              const expiryLabel = formatExpiryDate(item.expires_at);
              const coverThumb = item.image_urls[0] || null;
              const hasVideo = isValidYouTubeVideoId(item.youtube_video_id);
              const isRegionalOrGlobal =
                Boolean(item.is_global) ||
                (Array.isArray(item.target_hub_ids) && item.target_hub_ids.length > 1);

              return (
                <article
                  key={item.id}
                  data-testid={`bulletin-card-${item.id}`}
                  onClick={() => void handleOpenDetail(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void handleOpenDetail(item);
                    }
                  }}
                  className={`group rounded-2xl border bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3 cursor-pointer transition-all hover:border-[var(--ps-accent)]/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                    item.is_pinned
                      ? 'border-[var(--ps-accent)]/45 ring-1 ring-[var(--ps-accent)]/15'
                      : 'border-[var(--ps-border)]'
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Pinned + Category Tag + Regional/Global Badge + Media Indicators */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.is_pinned && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold uppercase tracking-wider">
                            <Pin className="w-3 h-3" aria-hidden="true" />
                            <span>Pinned</span>
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${catMeta.badgeClass}`}
                        >
                          <CatIcon className="w-3 h-3" aria-hidden="true" />
                          <span>{catMeta.label}</span>
                        </span>
                        {isRegionalOrGlobal && (
                          <span
                            data-testid={`bulletin-regional-badge-${item.id}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider"
                          >
                            <Globe className="w-3 h-3" aria-hidden="true" />
                            <span>Regional / Global</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        {hasVideo && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                            <span>Video</span>
                          </span>
                        )}
                        {item.image_urls.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]">
                            <ImageIcon className="w-2.5 h-2.5" aria-hidden="true" />
                            <span>{item.image_urls.length}</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleSave('bulletin', item.id);
                          }}
                          aria-label={
                            isSaved('bulletin', item.id)
                              ? 'Remove bulletin from saved'
                              : 'Save bulletin'
                          }
                          title={isSaved('bulletin', item.id) ? 'Saved' : 'Save bulletin'}
                          data-testid={`bulletin-save-card-${item.id}`}
                          className={`w-7 h-7 rounded-lg border inline-flex items-center justify-center transition-colors ${
                            isSaved('bulletin', item.id)
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:border-[var(--ps-accent)]/60'
                          }`}
                        >
                          <Bookmark
                            className={`w-3.5 h-3.5 ${
                              isSaved('bulletin', item.id) ? 'fill-current' : ''
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>

                    {/* Title + Excerpt + Optional Compact Thumbnail */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <h2 className="text-sm sm:text-base font-bold tracking-tight text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors line-clamp-2 leading-snug">
                          {item.title}
                        </h2>
                        {item.excerpt && (
                          <p className="text-xs leading-relaxed text-[var(--ps-text-muted)] line-clamp-3">
                            {item.excerpt}
                          </p>
                        )}
                      </div>

                      {coverThumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={coverThumb}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border border-[var(--ps-border)] shrink-0"
                        />
                      )}
                    </div>
                  </div>

                  {/* Footer: Author Accountability Badge + Follow Toggle + Linked Listing + Expiry */}
                  <div className="pt-2.5 border-t border-[var(--ps-border)]/70 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {item.authorAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.authorAvatarUrl}
                          alt={item.authorName}
                          referrerPolicy="no-referrer"
                          className="w-5 h-5 rounded-full object-cover border border-[var(--ps-border)] shrink-0"
                        />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[9px] font-bold text-[var(--ps-accent)] inline-flex items-center justify-center shrink-0">
                          {item.authorName.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="font-semibold text-[var(--ps-text)] truncate max-w-[130px]">
                        {item.authorName}
                      </span>
                      <span
                        title={
                          item.is_verified
                            ? 'Auto-Verified Publisher'
                            : roleMeta.label
                        }
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                          roleMeta.isAdmin
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {roleMeta.isAdmin || item.is_verified ? (
                          <ShieldCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <BadgeCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
                        )}
                        <span className="hidden sm:inline">
                          {item.is_verified && !roleMeta.isAdmin
                            ? 'Auto-Verified'
                            : roleMeta.label}
                        </span>
                      </span>
                      {item.author_id && authUser?.id !== item.author_id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleFollow('author', item.author_id);
                          }}
                          data-testid={`bulletin-follow-author-card-${item.id}`}
                          className={`h-5 px-1.5 rounded border text-[9px] font-bold inline-flex items-center gap-0.5 shrink-0 transition-colors ${
                            isFollowing('author', item.author_id)
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:border-[var(--ps-accent)]/60'
                          }`}
                        >
                          {isFollowing('author', item.author_id) ? (
                            <>
                              <UserCheck className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                              <span>Following</span>
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                              <span>Follow</span>
                            </>
                          )}
                        </button>
                      )}
                      <span className="text-[var(--ps-border)]">·</span>
                      <span className="text-[var(--ps-text-muted)] whitespace-nowrap shrink-0">
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.linked_listing_id && (
                        <Link
                          href={`/listing/${encodeURIComponent(item.linked_listing_id)}`}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`bulletin-card-linked-listing-${item.id}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[10px] font-semibold text-[var(--ps-accent)] hover:border-[var(--ps-accent)] transition-colors whitespace-nowrap"
                        >
                          <Store className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>Listing</span>
                        </Link>
                      )}
                      {expiryLabel && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--ps-text-muted)] whitespace-nowrap shrink-0">
                          <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>Exp. {expiryLabel}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const origin =
                            typeof window !== 'undefined'
                              ? window.location.origin
                              : '';
                          void share({
                            title: `${item.title} — DD oodle Bulletin`,
                            text: item.excerpt || `${item.title} (${activeHubName})`,
                            url: origin
                              ? `${origin}/bulletin?post=${encodeURIComponent(item.id)}`
                              : `/bulletin?post=${encodeURIComponent(item.id)}`,
                          });
                        }}
                        aria-label={`Share ${item.title}`}
                        title="Share bulletin"
                        data-testid={`bulletin-card-share-${item.id}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Load More Pagination */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void fetchBulletinsPage(offset + PAGE_SIZE, true)}
                disabled={isLoadingMore}
                data-testid="bulletin-load-more-btn"
                className="h-9 px-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Loading more...</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    <span>Load More Bulletins</span>
                  </>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Centered Framer Motion Bulletin Detail Modal */}
      <AnimatePresence>
        {activeBulletin && (
          <motion.div
            key="bulletin-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setActiveBulletin(null)}
            className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulletin-modal-title"
            data-testid="bulletin-detail-modal"
          >
            <motion.div
              key="bulletin-detail-panel"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
            >
              {/* Modal Header */}
              <div className="px-4 sm:px-5 py-3.5 border-b border-[var(--ps-border)] flex items-start justify-between gap-3 shrink-0 bg-[var(--ps-surface)]">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeBulletin.is_pinned && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold uppercase tracking-wider">
                        <Pin className="w-3 h-3" aria-hidden="true" />
                        <span>Pinned</span>
                      </span>
                    )}
                    {(() => {
                      const catMeta =
                        CATEGORY_META[activeBulletin.category] ||
                        CATEGORY_META.notice;
                      const CatIcon = catMeta.icon;
                      return (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${catMeta.badgeClass}`}
                        >
                          <CatIcon className="w-3 h-3" aria-hidden="true" />
                          <span>{catMeta.label}</span>
                        </span>
                      );
                    })()}
                    {(Boolean(activeBulletin.is_global) ||
                      (Array.isArray(activeBulletin.target_hub_ids) &&
                        activeBulletin.target_hub_ids.length > 1)) && (
                      <span
                        data-testid="bulletin-modal-regional-badge"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider"
                      >
                        <Globe className="w-3 h-3" aria-hidden="true" />
                        <span>Regional / Global</span>
                      </span>
                    )}
                    {activeBulletin.expires_at && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        <span>Expires {formatExpiryDate(activeBulletin.expires_at)}</span>
                      </span>
                    )}
                  </div>

                  <h2
                    id="bulletin-modal-title"
                    className="text-base sm:text-lg font-bold tracking-tight text-[var(--ps-text)] leading-snug"
                  >
                    {activeBulletin.title}
                  </h2>

                  {/* Author Accountability Bar + Follow Author */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
                    <span className="font-semibold text-[var(--ps-text)]">
                      {activeBulletin.authorName}
                    </span>
                    {(() => {
                      const roleMeta = getRoleBadgeMeta(activeBulletin.authorRole);
                      return (
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            roleMeta.isAdmin
                              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {roleMeta.isAdmin ? (
                            <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <BadgeCheck className="w-3 h-3" aria-hidden="true" />
                          )}
                          <span>{roleMeta.label}</span>
                        </span>
                      );
                    })()}
                    {activeBulletin.author_id && (
                      <button
                        type="button"
                        onClick={() =>
                          void toggleFollow('author', activeBulletin.author_id)
                        }
                        data-testid="bulletin-modal-follow-author"
                        className={`h-6 px-2 rounded-md border text-[10px] font-semibold inline-flex items-center gap-1 transition-colors ${
                          isFollowing('author', activeBulletin.author_id)
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        {isFollowing('author', activeBulletin.author_id) ? (
                          <>
                            <UserCheck className="w-3 h-3" aria-hidden="true" />
                            <span>Following</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3 h-3" aria-hidden="true" />
                            <span>Follow</span>
                          </>
                        )}
                      </button>
                    )}
                    <span className="text-[var(--ps-border)]">·</span>
                    <span>Posted {formatRelativeTime(activeBulletin.created_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleSave('bulletin', activeBulletin.id)}
                    aria-label={
                      isSaved('bulletin', activeBulletin.id)
                        ? 'Remove bulletin from saved'
                        : 'Save bulletin'
                    }
                    title={isSaved('bulletin', activeBulletin.id) ? 'Saved' : 'Save bulletin'}
                    data-testid="bulletin-modal-save-btn"
                    className={`w-8 h-8 rounded-xl border inline-flex items-center justify-center transition-colors ${
                      isSaved('bulletin', activeBulletin.id)
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)]'
                    }`}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${
                        isSaved('bulletin', activeBulletin.id) ? 'fill-current' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveBulletin(null)}
                    aria-label="Close bulletin details"
                    data-testid="bulletin-modal-close-btn"
                    className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center justify-center shrink-0 transition-colors"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Modal Scrollable Body */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
                {isDetailLoading ? (
                  <div className="space-y-2.5 py-4">
                    <div className="dd-shimmer h-4 w-full rounded" />
                    <div className="dd-shimmer h-4 w-11/12 rounded" />
                    <div className="dd-shimmer h-4 w-4/5 rounded" />
                  </div>
                ) : (
                  <BulletinContentRenderer
                    content={activeBulletin.content_json || activeBulletin.excerpt}
                  />
                )}

                {/* Image Gallery */}
                {activeBulletin.image_urls.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Attachments ({activeBulletin.image_urls.length})
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeBulletin.image_urls.map((imgUrl, idx) => (
                        <button
                          key={`${imgUrl}-${idx}`}
                          type="button"
                          onClick={() => setPreviewImageUrl(imgUrl)}
                          className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] transition-colors"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgUrl}
                            alt={`${activeBulletin.title} attachment ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sandboxed YouTube Video Player */}
                {isValidYouTubeVideoId(activeBulletin.youtube_video_id) && (
                  <YouTubeEmbedPlayer
                    videoId={activeBulletin.youtube_video_id}
                    title={activeBulletin.title}
                  />
                )}

                {/* Optional Linked Listing Deep Link */}
                {activeBulletin.linked_listing_id && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 p-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Store
                        className="w-4 h-4 text-[var(--ps-accent)] shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                          {activeBulletin.linkedListing?.title || 'Linked Local Business'}
                        </p>
                        {activeBulletin.linkedListing?.locality && (
                          <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                            {activeBulletin.linkedListing.locality}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/listing/${encodeURIComponent(activeBulletin.linked_listing_id)}`}
                      data-testid="bulletin-view-linked-listing"
                      onClick={() => setActiveBulletin(null)}
                      className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity shrink-0"
                    >
                      <span>View Linked Listing</span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}

                {/* Inline Report Form */}
                {isReportOpen && (
                  <form
                    onSubmit={(e) => void handleSubmitReport(e)}
                    data-testid="bulletin-report-form"
                    className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                        <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Report this bulletin</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsReportOpen(false)}
                        className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {REPORT_REASONS.map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => setSelectedReason(reason)}
                          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                            selectedReason === reason
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                          }`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={2}
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      placeholder="Optional extra details for moderators..."
                      className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                    />

                    {reportFeedback && (
                      <div
                        className={`text-xs font-semibold flex items-center gap-1.5 ${
                          reportFeedback.type === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {reportFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{reportFeedback.message}</span>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isSubmittingReport}
                        data-testid="bulletin-submit-report-btn"
                        className="h-8 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
                      >
                        {isSubmittingReport && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        <span>Submit Report</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Modal Footer: External Contact Bar + Report Trigger */}
              <div className="px-4 sm:px-5 py-3 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeContacts?.phone && (
                    <a
                      href={activeContacts.phone}
                      data-testid="bulletin-contact-call"
                      className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity"
                    >
                      <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Call</span>
                    </a>
                  )}
                  {activeContacts?.whatsapp && (
                    <a
                      href={activeContacts.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      data-testid="bulletin-contact-whatsapp"
                      className="h-8 px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-700 transition-colors"
                    >
                      <MessageCircle
                        className="w-3.5 h-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>WhatsApp</span>
                    </a>
                  )}
                  {activeContacts?.email && (
                    <a
                      href={activeContacts.email}
                      data-testid="bulletin-contact-email"
                      className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Email</span>
                    </a>
                  )}
                  {activeContacts?.website && (
                    <a
                      href={activeContacts.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      data-testid="bulletin-contact-website"
                      className="h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Website</span>
                    </a>
                  )}
                  {!activeContacts && (
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      No external response channels listed.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const origin =
                        typeof window !== 'undefined'
                          ? window.location.origin
                          : '';
                      void share({
                        title: `${activeBulletin.title} — DD oodle Bulletin`,
                        text:
                          activeBulletin.excerpt ||
                          `${activeBulletin.title} (${activeHubName})`,
                        url: origin
                          ? `${origin}/bulletin?post=${encodeURIComponent(activeBulletin.id)}`
                          : `/bulletin?post=${encodeURIComponent(activeBulletin.id)}`,
                      });
                    }}
                    data-testid="bulletin-modal-share-btn"
                    className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Share</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsReportOpen((prev) => !prev);
                      setReportFeedback(null);
                    }}
                    data-testid="bulletin-report-btn"
                    className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-rose-600 hover:border-rose-500/40 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Report</span>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Fullscreen Image Preview Lightbox */}
            {previewImageUrl && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewImageUrl(null);
                }}
                className="fixed inset-0 z-[10000] bg-black/85 flex items-center justify-center p-4"
              >
                <button
                  type="button"
                  onClick={() => setPreviewImageUrl(null)}
                  aria-label="Close image preview"
                  className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white hover:bg-white/25 inline-flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewImageUrl}
                  alt="Bulletin attachment preview"
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[85dvh] rounded-xl object-contain"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paid-Only Quota-Gated Bulletin Composer & Plans Modal */}
      <BulletinComposerModal
        open={isComposerOpen}
        initialMode={composerInitialMode}
        onClose={() => {
          setIsComposerOpen(false);
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            if (url.searchParams.has('plans') || url.searchParams.has('compose')) {
              url.searchParams.delete('plans');
              url.searchParams.delete('compose');
              window.history.replaceState({}, '', url.toString());
            }
          }
        }}
        onPublished={() => void fetchBulletinsPage(0, false)}
      />
    </div>
    </ModulePausedGuard>
  );
}
