'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import {
  ArrowUpRight,
  BotMessageSquare,
  HelpCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import {
  OVERLAY_STATE_EVENT,
  getActiveModalLockCount,
} from '@/hooks/useModalLock';
import type { HelpbotFaqRecord } from '@/lib/config/types';

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
  timestamp: string;
}

type DockSide = 'left' | 'right';

interface PersistedDockState {
  side: DockSide;
  yRatio: number;
}

const DOCK_STORAGE_KEY = 'ddoodle_assistant_dock_v2';
const DEFAULT_DOCK_STATE: PersistedDockState = { side: 'right', yRatio: 0.88 };
const LAUNCHER_SIZE = 44;
const EDGE_MARGIN = 12;
const DRAG_THRESHOLD_PX = 6;

const emptySubscribe = () => () => {};

export const DETERMINISTIC_FAQ_TOPICS: AssistantFaqTopic[] = [
  {
    id: 'map-filters',
    category: 'Explore',
    label: 'How to use the Map & Filters',
    keywords: [
      'map',
      'filter',
      'filters',
      'search',
      'locality',
      'cluster',
      'marker',
      'polygon',
      'draw',
      'simple mode',
      'real estate mode',
    ],
    response:
      'Use the Floating Map Toolbar and Category Filter pills to narrow listings across Churachandpur and Aizawl by category, locality, verification status, or keyword. Clicking any marker or cluster centers the map and opens the listing preview card.',
    deepLinkUrl: '/explore',
  },
  {
    id: 'categories-sample-rules',
    category: 'Directory',
    label: 'Listing Categories & Sample Data rules',
    keywords: [
      'category',
      'categories',
      'sample',
      'data',
      'business',
      'service',
      'public',
      'sports',
      'real estate',
      'sqm',
      'm2',
      'unit',
    ],
    response:
      'DD oodle organizes records into core categories: Businesses, Services, Real Estate, Public Interest / Civic Places, Vehicles & Rentals, and Sports Facilities. All land and floor measurements default strictly to square metres (m²).',
    deepLinkUrl: '/explore',
  },
  {
    id: 'real-estate-panorama',
    category: 'Real Estate',
    label: 'Real Estate 360° Panorama requirements',
    keywords: [
      '360',
      'panorama',
      'equirectangular',
      'virtual tour',
      'real estate',
      'property',
      'plot',
      'boundary',
      'publish',
    ],
    response:
      'Every Real Estate listing (plots, houses, villas, apartments, or commercial properties) must include at least one valid 2:1 equirectangular 360° panorama before it can be published.',
    deepLinkUrl: '/workspace',
  },
  {
    id: 'moderation-verification',
    category: 'Verification',
    label: 'Moderation & Verification process',
    keywords: [
      'moderation',
      'verification',
      'verify',
      'approve',
      'reject',
      'admin',
      'owner',
      'staff',
      'delegate',
      'csv',
      'export',
      'import',
    ],
    response:
      'Submitted listings enter the Admin / Hub Verification Queue where authorized officers inspect ownership documents, 360° panoramas, and boundary polygons before publishing.',
    deepLinkUrl: '/workspace',
  },
  {
    id: 'print-upload-how',
    category: 'Print & Digital',
    label: 'How do I upload and print documents?',
    keywords: [
      'print',
      'upload',
      'pdf',
      'document',
      'documents',
      'xerox',
      'photocopy',
      'photo to pdf',
      'print pro',
      'printswift',
      'order print',
      'binding',
      'lamination',
    ],
    response:
      'Open any Print Pro shop or Official PrintSwift listing and tap "Upload & Order Print". Upload PDFs directly (or stitch phone photos into a compressed PDF right in your browser), pick B&W/Color, duplex, copies, or binding, review your instant quote, and pay at the counter, via shop UPI, or DD oodle Escrow.',
    deepLinkUrl: '/explore?category=printing_digital_services',
  },
  {
    id: 'print-privacy-safety',
    category: 'Print & Digital',
    label: 'Are my uploaded PDFs and ID photos safe?',
    keywords: [
      'safe',
      'privacy',
      'private',
      'pdf',
      'id',
      'aadhaar',
      'photo',
      'photos',
      'delete',
      'auto delete',
      'purge',
      '48h',
      '48 hours',
      'signed',
      'bucket',
      'security',
    ],
    response:
      'Yes. All print files are uploaded to a strictly private storage vault under random non-PII keys. Your chosen print shop can only open files through 5-minute signed links while fulfilling your order, hub moderators cannot view your documents, and files are automatically erased 48 hours after collection.',
    deepLinkUrl: '/settings',
  },
  {
    id: 'print-pick-n-drop-delivery',
    category: 'Print & Digital',
    label: 'Can I get my printouts delivered via Pick N Drop?',
    keywords: [
      'deliver',
      'delivery',
      'pick n drop',
      'printout',
      'printouts',
      'courier',
      'doorstep',
      'escrow',
      'otp',
      'pickup',
    ],
    response:
      'Yes—when a Print Pro shop or Official PrintSwift enables Pick N Drop delivery, choose "Pick N Drop Delivery" during checkout. Delivery orders use DD oodle Escrow with OTP handover verification, and once printed you can track your printout delivery live in Activity.',
    deepLinkUrl: '/activity',
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

function mapHelpbotRecordsToTopics(
  records: HelpbotFaqRecord[]
): AssistantFaqTopic[] {
  const active = records.filter(
    (item) => item.is_active && item.question.trim() && item.answer.trim()
  );
  if (active.length === 0) return DETERMINISTIC_FAQ_TOPICS;

  return active.map((item) => ({
    id: item.id,
    category: item.category,
    label: item.question.trim(),
    keywords: Array.isArray(item.keywords)
      ? item.keywords.map((kw) => kw.trim().toLowerCase()).filter(Boolean)
      : [],
    response: item.answer.trim(),
    deepLinkUrl: item.deep_link_url?.trim() || null,
  }));
}

function resolveDynamicReply(
  query: string,
  topics: AssistantFaqTopic[],
  appName: string
): {
  topicLabel?: string;
  text: string;
  deepLinkUrl?: string | null;
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

function readLiveHeaderHeight(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 56;
  }
  const styles = getComputedStyle(document.documentElement);
  const visibleRaw = styles.getPropertyValue('--header-visible-height').trim();
  if (visibleRaw) {
    const visibleParsed = Number.parseFloat(visibleRaw);
    if (Number.isFinite(visibleParsed) && visibleParsed >= 0) {
      return visibleParsed;
    }
  }
  const fallbackParsed = Number.parseFloat(
    styles.getPropertyValue('--app-header-height')
  );
  return Number.isFinite(fallbackParsed) && fallbackParsed >= 0
    ? fallbackParsed
    : 56;
}

function computeLauncherBounds() {
  if (typeof window === 'undefined') {
    return {
      viewportW: 1280,
      viewportH: 720,
      leftX: EDGE_MARGIN,
      rightX: 1280 - LAUNCHER_SIZE - EDGE_MARGIN,
      minY: 72,
      maxY: 720 - 16 - LAUNCHER_SIZE - EDGE_MARGIN,
      bottomClearance: 16,
      headerHeight: 56,
    };
  }

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const headerHeight = readLiveHeaderHeight();
  const isPortraitOrMobile =
    viewportW < 768 ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(orientation: portrait)').matches);
  // Accounts for mobile BottomNav (~64px) + safe-area inset buffer
  const bottomClearance = isPortraitOrMobile ? 76 : 16;

  const leftX = EDGE_MARGIN;
  const rightX = Math.max(EDGE_MARGIN, viewportW - LAUNCHER_SIZE - EDGE_MARGIN);
  // Clear visible header + announcement bar when shown; stay safely on-screen when collapsed
  const minY = headerHeight > 0 ? Math.max(headerHeight + 12, 72) : 16;
  const maxY = Math.max(
    minY,
    viewportH - bottomClearance - LAUNCHER_SIZE - EDGE_MARGIN
  );

  return {
    viewportW,
    viewportH,
    leftX,
    rightX,
    minY,
    maxY,
    bottomClearance,
    headerHeight,
  };
}

function readPersistedDock(): PersistedDockState {
  if (typeof window === 'undefined') return DEFAULT_DOCK_STATE;
  try {
    const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
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

function projectDockToCoords(dock: PersistedDockState): { x: number; y: number } {
  const bounds = computeLauncherBounds();
  const clampedRatio = Math.min(1, Math.max(0, dock.yRatio));
  const x = dock.side === 'left' ? bounds.leftX : bounds.rightX;
  const y = Math.round(
    bounds.minY + (bounds.maxY - bounds.minY) * clampedRatio
  );
  return { x, y };
}

export function AssistantWidget() {
  const { helpbotFaqs, identity } = useAppConfig();
  const appName = identity.app_name?.trim() || 'DD oodle';
  const shortName = identity.short_name?.trim() || 'DD oodle';

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
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

  const panelDragControls = useDragControls();

  const clampPanelPosition = useCallback((desiredX: number, desiredY: number) => {
    if (typeof window === 'undefined') {
      return { x: 12, y: 72, panelW: 360, panelH: 480 };
    }
    const bounds = computeLauncherBounds();
    const margin = EDGE_MARGIN;
    const topSafe = bounds.headerHeight + 8;
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

  // Pass V2.1: Hydrate persisted dock side/yRatio and keep launcher & panel strictly clamped across resizes/rotations
  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;

    const syncAll = (usePersisted: boolean) => {
      const nextDock = usePersisted
        ? readPersistedDock()
        : dockStateRef.current;
      dockStateRef.current = nextDock;
      setDockState(nextDock);
      const projected = projectDockToCoords(nextDock);
      launcherPosRef.current = projected;
      setLauncherPos(projected);
      setPanelPos((prev) => {
        const clamped = clampPanelPosition(prev.x, prev.y);
        return { x: clamped.x, y: clamped.y };
      });
    };

    const rafId = window.requestAnimationFrame(() => syncAll(true));

    const handleViewportChange = () => {
      if (dragSessionRef.current.active) return;
      syncAll(false);
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);

    // Re-clamp immediately whenever --header-visible-height / --app-header-height updates on :root
    const headerObserver = new MutationObserver(handleViewportChange);
    headerObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-header-hidden'],
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      headerObserver.disconnect();
    };
  }, [mounted, clampPanelPosition]);

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

    // Magnetic horizontal edge docking based on horizontal midpoint
    const bounds = computeLauncherBounds();
    const current = launcherPosRef.current;
    const buttonCenterX = current.x + LAUNCHER_SIZE / 2;
    const nextSide: DockSide =
      buttonCenterX < bounds.viewportW / 2 ? 'left' : 'right';
    const snappedX = nextSide === 'left' ? bounds.leftX : bounds.rightX;
    const clampedY = Math.min(bounds.maxY, Math.max(bounds.minY, current.y));
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const nextYRatio = Math.min(1, Math.max(0, (clampedY - bounds.minY) / spanY));

    const nextDock: PersistedDockState = {
      side: nextSide,
      yRatio: Number(nextYRatio.toFixed(4)),
    };
    dockStateRef.current = nextDock;
    setDockState(nextDock);
    savePersistedDock(nextDock);

    const snappedPos = { x: Math.round(snappedX), y: Math.round(clampedY) };
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
    () => mapHelpbotRecordsToTopics(helpbotFaqs),
    [helpbotFaqs]
  );

  const welcomeMessage = useMemo<AssistantMessage>(
    () => ({
      id: 'welcome-0',
      sender: 'assistant',
      topicLabel: 'DD oodle Assistant',
      text: `Hello! I am your ${shortName} Assistant. Tap any quick topic below or ask about Explore, Pick N Drop, Vehicle Bookings, Payments, or Bulletins.`,
      timestamp: 'Just now',
    }),
    [shortName]
  );

  const messages = useMemo(
    () => [welcomeMessage, ...history],
    [welcomeMessage, history]
  );

  const appendInteraction = (questionText: string) => {
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
    const botMessage: AssistantMessage = {
      id: `bot-${seq}`,
      sender: 'assistant',
      topicLabel: resolved.topicLabel,
      text: resolved.text,
      deepLinkUrl: resolved.deepLinkUrl,
      timestamp: 'Now',
    };

    setHistory((prev) => [...prev, userMessage, botMessage]);
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
              }}
              data-dock-side={dockState.side}
              className={`fixed select-none ${
                isDraggingLauncher
                  ? 'transition-none'
                  : 'transition-[left,top] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
              } ${isOverlayOpen ? 'pointer-events-none' : 'pointer-events-auto'}`}
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
          // EXPANDED PANEL: ANCHORED TO DOCKED SIDE & CLAMPED AT z-[85]
          // ===================================================================
          <motion.div
            key="assistant-panel"
            drag
            dragControls={panelDragControls}
            dragListener={false}
            dragMomentum={false}
            onDragEnd={handlePanelDragEnd}
            initial={{ opacity: 0, scale: 0.9, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{
              left: panelPos.x,
              top: panelPos.y,
              transformOrigin:
                dockState.side === 'left' ? 'bottom left' : 'bottom right',
            }}
            role="dialog"
            aria-modal="false"
            aria-label={`${shortName} Assistant`}
            data-testid="assistant-widget-panel"
            className="pointer-events-auto fixed shadow-2xl rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-[min(380px,calc(100vw-24px))] max-h-[calc(100dvh-5.5rem)] flex flex-col z-[85]"
          >
            {/* Header-only drag handle bar */}
            <div
              onPointerDown={(e) => panelDragControls.start(e)}
              className="w-full h-6 cursor-grab active:cursor-grabbing bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center shrink-0 border-b border-slate-200 dark:border-slate-800 select-none touch-none hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
              title="Drag assistant window"
            >
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

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
              className="flex-1 min-h-[160px] sm:max-h-64 overflow-y-auto overscroll-contain space-y-2.5 bg-slate-50/70 dark:bg-slate-950/70 p-3.5 select-text"
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
            <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 shrink-0">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <HelpCircle className="h-3 w-3 text-theme-primary" />
                <span>Quick FAQ Topics</span>
              </div>
              <div
                data-testid="assistant-widget-topic-chips"
                style={{ overscrollBehavior: 'contain' }}
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto overscroll-contain custom-scrollbar"
              >
                {activeTopics.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    data-testid={`assistant-topic-chip-${topic.id}`}
                    onClick={() => appendInteraction(topic.label)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 text-left text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition hover:border-theme-primary hover:text-theme-primary hover:bg-theme-primary/5 cursor-pointer"
                  >
                    {topic.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                appendInteraction(inputValue);
              }}
              className="flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 shrink-0"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about Pick N Drop, vehicles, UPI..."
                aria-label={`Ask ${shortName} Assistant a question`}
                data-testid="assistant-widget-input"
                className="h-9 flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary"
              />
              <button
                type="submit"
                disabled={!inputValue.trim()}
                aria-label="Send question"
                data-testid="assistant-widget-send-btn"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-theme-primary text-theme-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-xs"
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
