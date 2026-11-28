'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHydrated } from '@/hooks/useHydrated';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import {
  ArrowUpRight,
  BotMessageSquare,
  HelpCircle,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { useAuth } from '@/lib/auth';
import {
  OVERLAY_STATE_EVENT,
  getActiveModalLockCount,
} from '@/hooks/useModalLock';
import type { HelpbotFaqRecord } from '@/lib/config/types';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
import {
  FLOATING_DOCK_SPRING_TRANSITION,
  FLOATING_DOCK_SYNC_EVENT,
  computeMiddleDockBand,
  resolveCollisionFreeDockPosition,
  unregisterFloatingDockSlot,
} from '@/lib/map/floating-dock';
import {
  getAssistantTopicsForRole,
  getRoleGuideById,
  resolveRoleGuideId,
} from '@/lib/guides/role-guides';

export interface AssistantFaqTopic {
  id: string;
  category?: string;
  label: string;
  keywords: string[];
  response: string;
  deepLinkUrl?: string | null;
}

interface AssistantMessage {
  id: string;
  sender: 'assistant' | 'user';
  topicLabel?: string;
  text: string;
  deepLinkUrl?: string | null;
  whatsappUrl?: string | null;
  timestamp: string;
}

type DockSide = 'left' | 'right';

interface PersistedDockState {
  side: DockSide;
  yRatio: number;
}

const DOCK_STORAGE_KEY = 'ddoodle_assistant_dock_v8';
const PREV_DOCK_STORAGE_KEY = 'ddoodle_assistant_dock_v2';
const DEFAULT_DOCK_STATE: PersistedDockState = { side: 'right', yRatio: 0.9 };
const LAUNCHER_SIZE = 44;
const EDGE_MARGIN = 12;
const DRAG_THRESHOLD_PX = 6;


export const DETERMINISTIC_FAQ_TOPICS: AssistantFaqTopic[] = [
  {
    id: 'role-guides-overview',
    category: 'All 8 Role Guides',
    label: 'Interactive Role Guides & Checklists (All 8 Roles)',
    keywords: [
      'guide',
      'guides',
      'help',
      'tutorial',
      'checklist',
      'role',
      'roles',
      'visitor',
      'owner',
      'staff',
      'driver',
      'mediator',
      'hub manager',
      'advertiser',
      'superadmin',
    ],
    response:
      'Open /guides to explore step-by-step interactive checklists, workflows, escrow & OTP safety rules, and troubleshooting FAQs for all 8 DD oodle roles (Visitor, Business Owner, Staff, Driver, Dispatch Mediator, Hub Manager, Advertiser, and Superadmin).',
    deepLinkUrl: '/guides',
  },
  {
    id: 'auth-google-email',
    category: 'Account & Onboarding',
    label: 'How do I sign in or complete Partner/Driver KYC?',
    keywords: [
      'login',
      'sign in',
      'signup',
      'google',
      'oauth',
      'email',
      'password',
      'onboarding',
      'kyc',
      'partner',
      'driver',
      'advertiser',
    ],
    response:
      'DD oodle uses fast Google OAuth PKCE and Email/Password authentication (no carrier SMS OTP wait). After signing in, complete the 2-step /onboarding setup or submit Business, Driver, or Advertiser KYC documents into our private kyc-documents vault.',
    deepLinkUrl: '/onboarding',
  },
  {
    id: 'map-filters-realestate',
    category: 'Explore & Real Estate',
    label: 'How do Map Filters, Sangam Land Units & Site Visits work?',
    keywords: [
      'map',
      'filter',
      'filters',
      'search',
      'locality',
      'polygon',
      'sangam',
      'sqft',
      'acre',
      'real estate',
      'plot',
      'site visit',
      '360',
      'panorama',
    ],
    response:
      'Filter /explore across 3 category levels and "Open Now". Zoom past level 16 on Real Estate listings to see drawn plot boundaries with area in Manipur Sangam, Sq.Ft, Acre, or m² (360° panoramas are optional). When a property owner approves your Site Visit request, their contact number unlocks live in real time.',
    deepLinkUrl: '/explore',
  },
  {
    id: 'pnd-escrow-otp',
    category: 'Pick N Drop & Fleet',
    label: 'How do Pick N Drop Escrow, 5 Fleet Tiers & Handover OTPs work?',
    keywords: [
      'pick n drop',
      'delivery',
      'courier',
      'ride',
      'lpg',
      'fleet',
      'rickshaw',
      'scooty',
      'bolero',
      'upi',
      'utr',
      'escrow',
      'otp',
      'pickup otp',
      'dropoff otp',
      'pod',
    ],
    response:
      'Lock Pickup (A) and Dropoff (B) in /explore?mode=pick_n_drop across 5 fleet tiers (Cycle Rickshaw, Scooty, E-Rickshaw, Mini Van, Pickup Truck) and submit your 12-digit UPI UTR. Your Pickup and Dropoff OTPs are private to you (cached offline in /profile#offline-otps)—drivers verify them at handover and upload a compressed <=250KB WebP POD photo (auto-purged after 48 hours).',
    deepLinkUrl: '/explore?mode=pick_n_drop',
  },
  {
    id: 'print-upload-how',
    category: 'Print & Digital',
    label: 'How do I upload and print PDF documents safely?',
    keywords: [
      'print',
      'upload',
      'pdf',
      'document',
      'documents',
      'xerox',
      'photocopy',
      'print pro',
      'binding',
      'lamination',
      '48h',
      'purge',
      'privacy',
    ],
    response:
      'Open any Print Pro shop or Official DD oodle print listing and tap "Upload & Order Print". Your PDF is stored in the private print-documents vault (accessible to the shop only via 5-minute signed links and automatically purged 48 hours after collection) and protected by your 6-digit Collection OTP.',
    deepLinkUrl: '/marketplace?tab=print',
  },
  {
    id: 'plans-trials-payper',
    category: 'Plans & Pay-Per',
    label: 'How do Default Free, Free Trials & Pay-Per Soft-Expiry work?',
    keywords: [
      'plan',
      'subscription',
      'free',
      'trial',
      'pay per',
      'pay-per',
      'paid_until',
      'renew',
      'expire',
      'expiry',
      'bulletin',
      'quota',
    ],
    response:
      'Every merchant gets the Default Free Tier baseline, can activate a one-time free trial on eligible Pro plans, or can purchase Pay-Per passes for Real Estate plots, Marketplace products, or Bulletins. When paid_until passes, items soft-expire from public feeds without data loss and can be renewed in 1 tap from your workspace.',
    deepLinkUrl: '/workspace',
  },
];

function isSafeDeepLink(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  );
}

function sanitizeLegacyBrandCopy(text: string): string {
  return text
    .replace(/PrintSwift\s+Local/gi, 'DD oodle')
    .replace(/Official\s+PrintSwift/gi, 'Official DD oodle');
}

function mapHelpbotRecordsToTopics(
  records: HelpbotFaqRecord[],
  roleOrHat?: string | null
): AssistantFaqTopic[] {
  const roleTopics = getAssistantTopicsForRole(roleOrHat);
  const active = records.filter(
    (item) => item.is_active && item.question.trim() && item.answer.trim()
  );

  const dbTopics: AssistantFaqTopic[] = active.map((item) => ({
    id: item.id,
    category: item.category,
    label: sanitizeLegacyBrandCopy(item.question.trim()),
    keywords: Array.isArray(item.keywords)
      ? item.keywords.map((kw) => kw.trim().toLowerCase()).filter(Boolean)
      : [],
    response: sanitizeLegacyBrandCopy(item.answer.trim()),
    deepLinkUrl: item.deep_link_url?.trim() || null,
  }));

  // Combine deterministic core topics + role-prioritized 8-role guide topics + live DB FAQs (deduplicated by label)
  const seenLabels = new Set<string>();
  const combined: AssistantFaqTopic[] = [];

  for (const t of [
    ...DETERMINISTIC_FAQ_TOPICS,
    ...roleTopics,
    ...dbTopics,
  ]) {
    const key = t.label.trim().toLowerCase();
    if (!key || seenLabels.has(key)) continue;
    seenLabels.add(key);
    combined.push(t);
  }

  return combined;
}

function resolveDynamicReply(
  query: string,
  topics: AssistantFaqTopic[],
  appName: string
): {
  topicLabel?: string;
  text: string;
  deepLinkUrl?: string | null;
  matchedFaq: boolean;
} {
  const normalized = query.trim().toLowerCase();

  const exactTopic = topics.find(
    (t) => t.label.toLowerCase() === normalized
  );
  if (exactTopic) {
    return {
      topicLabel: exactTopic.category || exactTopic.label,
      text: exactTopic.response,
      deepLinkUrl: exactTopic.deepLinkUrl,
      matchedFaq: true,
    };
  }

  if (
    normalized.includes('delete ') ||
    normalized.includes('approve my') ||
    normalized.includes('change my role') ||
    normalized.includes('reset database')
  ) {
    return {
      topicLabel: 'Read-Only Guardrail',
      text: `${appName} Assistant is a read-only help guide and never modifies database records or permissions directly. Please use Workspace or Contact Support for account actions.`,
      deepLinkUrl: '/contact',
      matchedFaq: true,
    };
  }

  const queryTokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);

  let bestTopic: AssistantFaqTopic | null = null;
  let bestScore = 0;

  for (const topic of topics) {
    let score = 0;
    const questionLower = topic.label.toLowerCase();
    const answerLower = topic.response.toLowerCase();

    for (const kw of topic.keywords) {
      if (!kw) continue;
      if (normalized.includes(kw)) {
        score += kw.length * 3;
      } else if (
        queryTokens.some((tok) => kw.includes(tok) || tok.includes(kw))
      ) {
        score += 4;
      }
    }

    for (const token of queryTokens) {
      if (questionLower.includes(token)) {
        score += token.length * 2;
      }
      if (answerLower.includes(token)) {
        score += Math.min(token.length, 4);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  if (bestTopic && bestScore > 0) {
    return {
      topicLabel: bestTopic.category || bestTopic.label,
      text: bestTopic.response,
      deepLinkUrl: bestTopic.deepLinkUrl,
      matchedFaq: true,
    };
  }

  const sampleSuggestions = topics
    .slice(0, 3)
    .map((t) => `"${t.label}"`)
    .join(', ');

  return {
    topicLabel: 'Local Knowledge Base',
    text: `I am your DD oodle Assistant. Tap one of the FAQ topics below—such as ${sampleSuggestions || 'Explore, Pick N Drop, or Payments'}—or reach our local support desk for assistance.`,
    deepLinkUrl: '/contact',
    matchedFaq: false,
  };
}

function detectOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  if (getActiveModalLockCount() > 0) return true;
  if (document.documentElement.getAttribute('data-modal-open') === 'true') {
    return true;
  }
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

function computeLauncherBounds() {
  if (typeof window === 'undefined') {
    return {
      viewportW: 1280,
      viewportH: 720,
      leftX: EDGE_MARGIN,
      rightX: 1280 - LAUNCHER_SIZE - EDGE_MARGIN,
      minY: 173,
      maxY: 720 - 164 - LAUNCHER_SIZE,
      bottomClearance: 76,
      headerHeight: 56,
    };
  }

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const isPortraitOrMobile =
    viewportW < 768 ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(orientation: portrait)').matches);
  const bottomClearance = isPortraitOrMobile ? 76 : 16;

  const leftX = EDGE_MARGIN;
  const rightX = Math.max(EDGE_MARGIN, viewportW - LAUNCHER_SIZE - EDGE_MARGIN);
  const band = computeMiddleDockBand(viewportH, LAUNCHER_SIZE);

  return {
    viewportW,
    viewportH,
    leftX,
    rightX,
    minY: band.minY,
    maxY: band.maxY,
    bottomClearance,
    headerHeight: 56,
  };
}

function readPersistedDock(): PersistedDockState {
  if (typeof window === 'undefined') return DEFAULT_DOCK_STATE;
  try {
    const raw =
      window.localStorage.getItem(DOCK_STORAGE_KEY) ||
      window.localStorage.getItem(PREV_DOCK_STORAGE_KEY);
    if (!raw) return DEFAULT_DOCK_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedDockState>;
    const side: DockSide = parsed.side === 'left' ? 'left' : 'right';
    const yRatio =
      typeof parsed.yRatio === 'number' && Number.isFinite(parsed.yRatio)
        ? Math.min(1, Math.max(0, parsed.yRatio))
        : DEFAULT_DOCK_STATE.yRatio;
    return { side, yRatio };
  } catch {
    return DEFAULT_DOCK_STATE;
  }
}

function savePersistedDock(dock: PersistedDockState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(dock));
  } catch {
    // Ignore storage quota / private mode restrictions
  }
}

function projectDockToCoords(
  dock: PersistedDockState,
  explicitY?: number,
  commitSlot = true
): { x: number; y: number; yRatio: number } {
  const bounds = computeLauncherBounds();
  const resolved = resolveCollisionFreeDockPosition(
    {
      id: 'assistant-widget',
      side: dock.side,
      desiredLocalY: explicitY,
      bandRatio: dock.yRatio,
      controlWidth: LAUNCHER_SIZE,
      controlHeight: LAUNCHER_SIZE,
      containerWidth: bounds.viewportW,
      containerHeight: bounds.viewportH,
      viewportHeight: bounds.viewportH,
      containerViewportTop: 0,
      edgeMargin: EDGE_MARGIN,
    },
    commitSlot
  );
  return {
    x: resolved.x,
    y: resolved.y,
    yRatio: resolved.yRatio,
  };
}

export function AssistantWidget() {
  const { helpbotFaqs, identity, activeHub, office, supportWhatsApp } =
    useAppConfig();
  const { user, fullName, role: authRole, realRole } = useAuth();
  const pathname = usePathname();
  const activeRoleGuide = useMemo(
    () => getRoleGuideById(resolveRoleGuideId(authRole || realRole || 'visitor')),
    [authRole, realRole]
  );
  const appName = identity.app_name?.trim() || 'DD oodle';
  const shortName = identity.short_name?.trim() || 'DD oodle';
  const companyWhatsApp =
    supportWhatsApp?.trim() ||
    office.whatsapp?.trim() ||
    office.phone?.trim() ||
    '';

  const mounted = useHydrated();
  const [isOpen, setIsOpen] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<AssistantMessage[]>([]);
  const counterRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [dockState, setDockState] = useState<PersistedDockState>(
    DEFAULT_DOCK_STATE
  );
  const dockStateRef = useRef<PersistedDockState>(DEFAULT_DOCK_STATE);
  const [launcherPos, setLauncherPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const launcherPosRef = useRef<{ x: number; y: number }>({ x: 12, y: 500 });
  const [isDraggingLauncher, setIsDraggingLauncher] = useState(false);
  const suppressNextClickRef = useRef(false);

  const dragSessionRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>({
    x: 12,
    y: 72,
  });
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(false);
  const [mobileVp, setMobileVp] = useState<{ top: number; height: number }>({
    top: 0,
    height: 720,
  });
  const [isInputFocused, setIsInputFocused] = useState<boolean>(false);

  const panelDragControls = useDragControls();

  const scrollMessagesToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, []);

  const clampPanelPosition = useCallback((desiredX: number, desiredY: number) => {
    if (typeof window === 'undefined') {
      return { x: 12, y: 72, panelW: 360, panelH: 480 };
    }
    const bounds = computeLauncherBounds();
    const margin = EDGE_MARGIN;
    const topSafe = 64;
    const bottomSafe = bounds.bottomClearance + 4;

    const panelW = Math.min(bounds.viewportW - margin * 2, 380);
    const panelH = Math.min(bounds.viewportH - topSafe - bottomSafe, 520);

    const minX = margin;
    const maxX = Math.max(margin, bounds.viewportW - panelW - margin);
    const minY = topSafe;
    const maxY = Math.max(topSafe, bounds.viewportH - bottomSafe - panelH);

    const x = Math.min(Math.max(desiredX, minX), maxX);
    const y = Math.min(Math.max(desiredY, minY), maxY);

    return { x, y, panelW, panelH };
  }, []);

  // Pass V8: Track visualViewport on mobile (< md) so soft keyboard opening shrinks the modal cleanly above the keyboard
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;

    const syncVisualViewport = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextIsMobile = vw < 768;
      setIsMobileViewport(nextIsMobile);

      const vv = window.visualViewport;
      const vpHeight = Math.round(vv ? vv.height : vh);
      const vpTop = Math.round(vv ? vv.offsetTop : 0);
      setMobileVp((prev) =>
        prev.top === vpTop && prev.height === vpHeight
          ? prev
          : { top: vpTop, height: vpHeight }
      );
      if (nextIsMobile && isOpen) {
        window.requestAnimationFrame(scrollMessagesToBottom);
      }
    };

    syncVisualViewport();
    const vv = window.visualViewport;
    window.addEventListener('resize', syncVisualViewport);
    vv?.addEventListener('resize', syncVisualViewport);
    vv?.addEventListener('scroll', syncVisualViewport);

    return () => {
      window.removeEventListener('resize', syncVisualViewport);
      vv?.removeEventListener('resize', syncVisualViewport);
      vv?.removeEventListener('scroll', syncVisualViewport);
    };
  }, [mounted, isOpen, scrollMessagesToBottom]);

  // Pass V8: Hydrate persisted dock side/yRatio in the fixed middle band (decoupled from header scroll)
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;

    const syncAll = (usePersisted: boolean, commitSlot = true) => {
      const nextDock = usePersisted
        ? readPersistedDock()
        : dockStateRef.current;
      dockStateRef.current = nextDock;
      setDockState(nextDock);
      const projected = projectDockToCoords(nextDock, undefined, commitSlot);
      launcherPosRef.current = { x: projected.x, y: projected.y };
      setLauncherPos({ x: projected.x, y: projected.y });
      setPanelPos((prev) => {
        const clamped = clampPanelPosition(prev.x, prev.y);
        return { x: clamped.x, y: clamped.y };
      });
    };

    const rafId = window.requestAnimationFrame(() => syncAll(true, true));

    const handleViewportChange = () => {
      if (dragSessionRef.current.active) return;
      syncAll(false, true);
    };

    const handlePeerDockSync = (ev: Event) => {
      const detail = (ev as CustomEvent<{ sourceId?: string }>).detail;
      if (detail?.sourceId === 'assistant-widget') return;
      if (dragSessionRef.current.active) return;
      syncAll(false, false);
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    window.addEventListener(FLOATING_DOCK_SYNC_EVENT, handlePeerDockSync);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      window.removeEventListener(FLOATING_DOCK_SYNC_EVENT, handlePeerDockSync);
      unregisterFloatingDockSlot('assistant-widget');
    };
  }, [mounted, clampPanelPosition, pathname]);

  // Pass V2: Automatically detect any open Drawer or Modal and hide/dim AssistantWidget
  useEffect(() => {
    if (
      !mounted ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const syncOverlay = () => {
      const next = detectOverlayOpen();
      setIsOverlayOpen(next);
      if (next) {
        setIsOpen(false);
      }
    };

    syncOverlay();
    window.addEventListener(OVERLAY_STATE_EVENT, syncOverlay);

    const observer = new MutationObserver(syncOverlay);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-modal-open', 'style'],
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'role'],
    });

    return () => {
      window.removeEventListener(OVERLAY_STATE_EVENT, syncOverlay);
      observer.disconnect();
    };
  }, [mounted]);

  const handleOpenPanel = useCallback(() => {
    if (typeof window === 'undefined') {
      setIsOpen(true);
      return;
    }
    const bounds = computeLauncherBounds();
    const margin = EDGE_MARGIN;
    const panelW = Math.min(bounds.viewportW - margin * 2, 380);
    const panelH = Math.min(
      bounds.viewportH - (bounds.headerHeight + 8) - (bounds.bottomClearance + 4),
      500
    );

    const side = dockStateRef.current.side;
    const openX =
      side === 'left' ? margin : Math.max(margin, bounds.viewportW - panelW - margin);
    const preferredBottomY = launcherPosRef.current.y + LAUNCHER_SIZE - panelH;
    const clamped = clampPanelPosition(openX, preferredBottomY);
    setPanelPos({ x: clamped.x, y: clamped.y });
    setIsOpen(true);
  }, [clampPanelPosition]);

  // Pointer-based smooth dragging with 6px tap/drag threshold & magnetic horizontal edge docking
  const handleLauncherPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isOverlayOpen) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events without capture support
    }

    const current = launcherPosRef.current;
    dragSessionRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: current.x,
      originY: current.y,
      moved: false,
    };
  };

  const handleLauncherPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session.active || session.pointerId !== e.pointerId) return;

    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;

    if (!session.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      setIsDraggingLauncher(true);
    }

    const bounds = computeLauncherBounds();
    const nextX = Math.min(
      bounds.rightX,
      Math.max(bounds.leftX, session.originX + dx)
    );
    const nextY = Math.min(
      bounds.maxY,
      Math.max(bounds.minY, session.originY + dy)
    );

    const nextPos = { x: Math.round(nextX), y: Math.round(nextY) };
    launcherPosRef.current = nextPos;
    setLauncherPos(nextPos);
  };

  const finishLauncherPointer = (
    e: React.PointerEvent<HTMLButtonElement>,
    cancelled: boolean
  ) => {
    const session = dragSessionRef.current;
    if (!session.active || session.pointerId !== e.pointerId) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    const wasMoved = session.moved;
    session.active = false;
    session.pointerId = null;
    session.moved = false;
    setIsDraggingLauncher(false);

    if (!wasMoved) {
      if (!cancelled) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 120);
        handleOpenPanel();
      }
      return;
    }

    // Prevent trailing synthetic click after drag release
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 150);

    // Magnetic horizontal edge docking based on horizontal midpoint + peer collision avoidance
    const bounds = computeLauncherBounds();
    const current = launcherPosRef.current;
    const buttonCenterX = current.x + LAUNCHER_SIZE / 2;
    const nextSide: DockSide =
      buttonCenterX < bounds.viewportW / 2 ? 'left' : 'right';

    const projected = projectDockToCoords(
      { side: nextSide, yRatio: dockStateRef.current.yRatio },
      current.y,
      true
    );

    const nextDock: PersistedDockState = {
      side: nextSide,
      yRatio: projected.yRatio,
    };
    dockStateRef.current = nextDock;
    setDockState(nextDock);
    savePersistedDock(nextDock);

    const snappedPos = { x: Math.round(projected.x), y: Math.round(projected.y) };
    launcherPosRef.current = snappedPos;
    setLauncherPos(snappedPos);
  };

  const handleLauncherClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    handleOpenPanel();
  };

  const activeTopics = useMemo(
    () => mapHelpbotRecordsToTopics(helpbotFaqs, activeRoleGuide.id),
    [helpbotFaqs, activeRoleGuide.id]
  );

  const welcomeMessage = useMemo<AssistantMessage>(
    () => ({
      id: 'welcome-0',
      sender: 'assistant',
      topicLabel: `${shortName} Assistant • ${activeRoleGuide.shortTitle} Guide`,
      text: `Hello! I am your ${shortName} Assistant (tailored for ${activeRoleGuide.shortTitle}). Tap any quick topic below, ask about Explore, Pick N Drop, Vehicle Bookings, Escrow OTPs, or open the full 8-Role Interactive Guides.`,
      deepLinkUrl: `/guides?role=${encodeURIComponent(activeRoleGuide.id)}`,
      timestamp: 'Just now',
    }),
    [shortName, activeRoleGuide.id, activeRoleGuide.shortTitle]
  );

  const messages = useMemo(
    () => [welcomeMessage, ...history],
    [welcomeMessage, history]
  );

  const appendInteraction = (questionText: string, isCustomMessage = false) => {
    const trimmed = questionText.trim();
    if (!trimmed) return;

    const seq = counterRef.current++;
    const userMessage: AssistantMessage = {
      id: `user-${seq}`,
      sender: 'user',
      text: trimmed,
      timestamp: 'Now',
    };

    const resolved = resolveDynamicReply(trimmed, activeTopics, appName);
    const nextMessages: AssistantMessage[] = [userMessage];

    if (!isCustomMessage) {
      nextMessages.push({
        id: `bot-${seq}`,
        sender: 'assistant',
        topicLabel: resolved.topicLabel,
        text: resolved.text,
        deepLinkUrl: resolved.deepLinkUrl,
        timestamp: 'Now',
      });
    } else {
      if (resolved.matchedFaq) {
        nextMessages.push({
          id: `bot-faq-${seq}`,
          sender: 'assistant',
          topicLabel: resolved.topicLabel,
          text: resolved.text,
          deepLinkUrl: resolved.deepLinkUrl,
          timestamp: 'Now',
        });
      }

      const userLabel =
        fullName?.trim() ||
        user?.phone?.trim() ||
        user?.email?.trim() ||
        'Guest';
      const waUrl = buildContextualWhatsAppUrl(companyWhatsApp, {
        type: 'chatbot_support',
        hub: activeHub?.name || 'Default Hub',
        path: pathname || '/',
        userName: userLabel,
        userText: trimmed,
      });

      nextMessages.push({
        id: `bot-wa-${seq}`,
        sender: 'assistant',
        topicLabel: 'WhatsApp Support Handoff',
        text: resolved.matchedFaq
          ? `Need direct help from our ${activeHub?.name || 'local'} team? Continue this message on ${shortName} WhatsApp support with your page context prefilled.`
          : `We've prepared your message for ${shortName} WhatsApp support (${activeHub?.name || 'Local Desk'}) with your current page context. Tap below if WhatsApp didn't open automatically.`,
        whatsappUrl: waUrl,
        timestamp: 'Now',
      });

      try {
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // Fallback card in thread remains directly clickable
      }
    }

    setHistory((prev) => [...prev, ...nextMessages]);
    setInputValue('');

    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
    }, 30);
  };

  const handleResetChat = () => {
    setHistory([]);
    setInputValue('');
  };

  const handlePanelDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: { point: { x: number; y: number } }
  ) => {
    const clamped = clampPanelPosition(info.point.x, info.point.y);
    setPanelPos({ x: clamped.x, y: clamped.y });
  };

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  const portalContent = (
    <div
      data-testid="assistant-widget-root"
      aria-hidden={isOverlayOpen}
      className={`ddoodle-assistant-root pointer-events-none fixed inset-0 overflow-hidden transition-opacity duration-200 ${
        isOpen ? 'z-[85]' : 'z-[55]'
      } ${isOverlayOpen ? 'opacity-0' : 'opacity-100'}`}
    >
      <AnimatePresence mode="wait">
        {!isOpen ? (
          // ===================================================================
          // COLLAPSED LAUNCHER: MAGNETIC DRAGGABLE & EDGE-DOCKED (z-[55])
          // Smooth pointer/touch dragging with 6px tap threshold, strict
          // viewport clamping & horizontal edge snapping on release.
          // ===================================================================
          launcherPos && (
            <motion.div
              key="assistant-dock"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{
                opacity: isOverlayOpen ? 0 : 1,
                scale: isOverlayOpen ? 0.85 : 1,
              }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16 }}
              style={{
                left: launcherPos.x,
                top: launcherPos.y,
                transition: isDraggingLauncher
                  ? 'none'
                  : FLOATING_DOCK_SPRING_TRANSITION,
                willChange: 'left, top',
              }}
              data-dock-side={dockState.side}
              className={`fixed select-none ${
                isOverlayOpen ? 'pointer-events-none' : 'pointer-events-auto'
              }`}
            >
              <button
                type="button"
                onPointerDown={handleLauncherPointerDown}
                onPointerMove={handleLauncherPointerMove}
                onPointerUp={(e) => finishLauncherPointer(e, false)}
                onPointerCancel={(e) => finishLauncherPointer(e, true)}
                onClick={handleLauncherClick}
                aria-label={`Open ${shortName} Assistant (drag to move)`}
                title={`Tap to open ${shortName} Assistant or drag to reposition`}
                data-testid="assistant-docked-tab"
                className={`relative group flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl bg-theme-primary text-theme-primary-foreground shadow-lg shadow-theme-primary/25 ring-2 ring-white/25 dark:ring-slate-900/60 backdrop-blur-md touch-none select-none transition-transform ${
                  isDraggingLauncher
                    ? 'scale-105 cursor-grabbing shadow-2xl ring-white/50'
                    : 'cursor-grab hover:scale-105 active:scale-95'
                }`}
              >
                <BotMessageSquare className="h-5 w-5 text-theme-primary-foreground drop-shadow-sm pointer-events-none" />
                <span className="pointer-events-none absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 ring-1 ring-white/60 dark:ring-slate-900" />
                </span>
              </button>
            </motion.div>
          )
        ) : (
          // ===================================================================
          // EXPANDED PANEL: KEYBOARD-SAFE VISUAL VIEWPORT ON MOBILE (< md),
          // DRAGGABLE & CLAMPED ON DESKTOP (>= md) AT z-[85]
          // ===================================================================
          <motion.div
            key="assistant-panel"
            drag={!isMobileViewport}
            dragControls={panelDragControls}
            dragListener={false}
            dragMomentum={false}
            onDragEnd={handlePanelDragEnd}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={
              isMobileViewport
                ? {
                    left: 8,
                    right: 8,
                    top: mobileVp.top + 8,
                    height: Math.max(220, mobileVp.height - 16),
                    maxHeight: Math.max(220, mobileVp.height - 16),
                  }
                : {
                    left: panelPos.x,
                    top: panelPos.y,
                    height: 'min(520px, calc(100dvh - 5.5rem))',
                    maxHeight: 'calc(100dvh - 5.5rem)',
                    transformOrigin:
                      dockState.side === 'left' ? 'bottom left' : 'bottom right',
                  }
            }
            role="dialog"
            aria-modal="false"
            aria-label={`${shortName} Assistant`}
            data-testid="assistant-widget-panel"
            className={`pointer-events-auto fixed shadow-2xl rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col z-[85] ${
              isMobileViewport
                ? 'w-auto'
                : 'w-[min(380px,calc(100vw-24px))]'
            }`}
          >
            {/* Header-only drag handle bar (desktop only) */}
            {!isMobileViewport && (
              <div
                onPointerDown={(e) => panelDragControls.start(e)}
                className="w-full h-6 cursor-grab active:cursor-grabbing bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center shrink-0 border-b border-slate-200 dark:border-slate-800 select-none touch-none hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
                title="Drag assistant window"
              >
                <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              </div>
            )}

            {/* Header Bar */}
            <div className="flex items-center justify-between gap-2 bg-theme-primary px-3.5 py-2.5 text-theme-primary-foreground select-none shrink-0 shadow-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/20">
                  <BotMessageSquare className="h-3.5 w-3.5 text-theme-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold tracking-tight truncate block leading-tight">
                    {shortName} Assistant
                  </span>
                  <span className="text-[10px] opacity-85 block leading-none">
                    Your Daily Discovery Guide
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleResetChat}
                  title="Reset conversation"
                  aria-label="Reset conversation"
                  data-testid="assistant-widget-reset-btn"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-85 hover:opacity-100 hover:bg-white/20 transition cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  title={`Close ${shortName} Assistant`}
                  aria-label={`Close ${shortName} Assistant`}
                  data-testid="assistant-widget-close-btn"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-85 hover:opacity-100 hover:bg-white/20 transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Security / Knowledge Banner */}
            <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="truncate">
                Local knowledge base &amp; FAQs — instant &amp; offline ready.
              </span>
            </div>

            {/* Chat Message History */}
            <div
              ref={scrollContainerRef}
              data-testid="assistant-widget-messages"
              style={{ overscrollBehavior: 'contain' }}
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2.5 bg-slate-50/70 dark:bg-slate-950/70 p-3.5 select-text"
            >
              {messages.map((msg) => {
                const safeUrl = isSafeDeepLink(msg.deepLinkUrl)
                  ? msg.deepLinkUrl.trim()
                  : null;
                const isInternal = Boolean(safeUrl && safeUrl.startsWith('/'));

                return (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.sender === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-xs space-y-2 ${
                        msg.sender === 'user'
                          ? 'bg-theme-primary text-theme-primary-foreground rounded-br-xs'
                          : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-bl-xs'
                      }`}
                    >
                      {msg.sender === 'assistant' && msg.topicLabel && (
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-theme-primary">
                          <Sparkles className="h-3 w-3 shrink-0" />
                          <span className="truncate">{msg.topicLabel}</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                      {msg.sender === 'assistant' && msg.whatsappUrl && (
                        <div className="pt-1">
                          <a
                            href={msg.whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="assistant-whatsapp-handoff-link"
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-[11px] font-bold text-white shadow-xs transition-colors hover:bg-emerald-700"
                          >
                            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>Open in WhatsApp →</span>
                          </a>
                        </div>
                      )}
                      {msg.sender === 'assistant' && safeUrl && (
                        <div className="pt-0.5">
                          {isInternal ? (
                            <Link
                              href={safeUrl}
                              onClick={() => setIsOpen(false)}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/30 text-[11px] font-bold text-theme-primary hover:bg-theme-primary hover:text-theme-primary-foreground transition-colors"
                            >
                              <span>Open Page</span>
                              <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          ) : (
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-theme-primary/10 border border-theme-primary/30 text-[11px] font-bold text-theme-primary hover:bg-theme-primary hover:text-theme-primary-foreground transition-colors"
                            >
                              <span>Open Link</span>
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Clickable Topic Chips */}
            <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 shrink-0">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <HelpCircle className="h-3 w-3 text-theme-primary" />
                <span>Quick FAQ Topics</span>
              </div>
              <div
                data-testid="assistant-widget-topic-chips"
                style={{ overscrollBehavior: 'contain' }}
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                className={`flex gap-1.5 overflow-y-auto overscroll-contain custom-scrollbar ${
                  isMobileViewport && (isInputFocused || mobileVp.height < 520)
                    ? 'flex-nowrap overflow-x-auto max-h-10 pb-0.5'
                    : 'flex-wrap max-h-20 sm:max-h-24'
                }`}
              >
                {activeTopics.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    data-testid={`assistant-topic-chip-${topic.id}`}
                    onClick={() => appendInteraction(topic.label, false)}
                    className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 text-left text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition hover:border-theme-primary hover:text-theme-primary hover:bg-theme-primary/5 cursor-pointer"
                  >
                    {topic.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Bar (Keyboard-Safe Bottom Composer) */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                appendInteraction(inputValue, true);
              }}
              className="flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => {
                  setIsInputFocused(true);
                  window.setTimeout(scrollMessagesToBottom, 60);
                }}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Type a question to send to WhatsApp support..."
                aria-label={`Ask ${shortName} Assistant or message WhatsApp support`}
                data-testid="assistant-widget-input"
                className="h-9 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                aria-label="Send to WhatsApp support"
                data-testid="assistant-widget-send-btn"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-theme-primary text-theme-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return createPortal(portalContent, document.body);
}

export default AssistantWidget;
