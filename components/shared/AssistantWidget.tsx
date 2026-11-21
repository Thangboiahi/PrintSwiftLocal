'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import {
  ArrowUpRight,
  BotMessageSquare,
  HelpCircle,
  MessageSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
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

interface StoredDockPosition {
  side: 'left' | 'right';
  yRatio?: number;
  y?: number;
}

const STORAGE_KEY = 'ddoodle:assistant-dock-pos';
const DOCK_SIZE = 46;

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

  // 1. Exact match on question / topic label
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

  // 2. Guardrail for write/mutation requests
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

  // 3. Weighted scoring across keywords[], question, and answer
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
      } else if (queryTokens.some((tok) => kw.includes(tok) || tok.includes(kw))) {
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

export function AssistantWidget() {
  const { helpbotFaqs, identity } = useAppConfig();
  const appName = identity.app_name?.trim() || 'DD oodle';
  const shortName = identity.short_name?.trim() || 'DD oodle';

  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<AssistantMessage[]>([]);
  const counterRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Position state for corner docking with edge-snap and clamping
  const [dockPos, setDockPos] = useState<{
    side: 'left' | 'right';
    y: number;
    yRatio: number;
  }>({
    side: 'right',
    y: 360,
    yRatio: 0.55,
  });

  // Panel placement coordinates inside viewport
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>({
    x: 12,
    y: 72,
  });

  const panelDragControls = useDragControls();
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIsDraggingRef = useRef(false);

  // Helper to compute safe bounds based on current viewport
  const getDockBounds = useCallback(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 390;
    const h = typeof window !== 'undefined' ? window.innerHeight : 844;
    const isMobile = w < 768;
    const topSafe = 72;
    const bottomSafe = isMobile ? 96 : 24;
    const minY = topSafe;
    const maxY = Math.max(topSafe, h - bottomSafe - DOCK_SIZE);
    return { w, h, isMobile, topSafe, bottomSafe, minY, maxY };
  }, []);

  const clampPanelPosition = useCallback((desiredX: number, desiredY: number) => {
    if (typeof window === 'undefined') return { x: 12, y: 72, panelW: 360, panelH: 480 };
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = w < 768;
    const margin = 12;
    const topSafe = 68;
    const bottomSafe = isMobile ? 84 : 20;

    const panelW = Math.min(w - margin * 2, 380);
    const panelH = Math.min(h - topSafe - bottomSafe, 520);

    const minX = margin;
    const maxX = Math.max(margin, w - panelW - margin);
    const minY = topSafe;
    const maxY = Math.max(topSafe, h - bottomSafe - panelH);

    const x = Math.min(Math.max(desiredX, minX), maxX);
    const y = Math.min(Math.max(desiredY, minY), maxY);

    return { x, y, panelW, panelH };
  }, []);

  // Hydration guard for portal mounting
  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
    });
  }, []);

  // Load persisted dock position from localStorage on mount & handle resize
  useEffect(() => {
    if (!mounted) return;

    const applySavedPosition = () => {
      const { minY, maxY, h } = getDockBounds();
      let side: 'left' | 'right' = 'right';
      let yRatio = 0.55;

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredDockPosition;
          if (parsed.side === 'left' || parsed.side === 'right') {
            side = parsed.side;
          }
          if (typeof parsed.yRatio === 'number' && !Number.isNaN(parsed.yRatio)) {
            yRatio = Math.min(Math.max(parsed.yRatio, 0), 1);
          } else if (typeof parsed.y === 'number') {
            yRatio = Math.min(Math.max((parsed.y - minY) / Math.max(1, maxY - minY), 0), 1);
          }
        }
      } catch {
        // Fallback to default
      }

      const calculatedY = Math.round(minY + yRatio * Math.max(0, maxY - minY));
      const clampedY = Math.min(Math.max(minY, calculatedY), maxY);

      setDockPos({ side, y: clampedY, yRatio });
    };

    applySavedPosition();

    const handleResize = () => {
      setDockPos((prev) => {
        const { minY, maxY } = getDockBounds();
        const nextY = Math.round(minY + prev.yRatio * Math.max(0, maxY - minY));
        const clampedY = Math.min(Math.max(minY, nextY), maxY);
        return { ...prev, y: clampedY };
      });

      // Also reclamp expanded panel if open
      setPanelPos((prev) => {
        const { x, y } = clampPanelPosition(prev.x, prev.y);
        return { x, y };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mounted, getDockBounds, clampPanelPosition]);

  // When opening panel, calculate clamped ideal entry coordinates
  const handleOpenPanel = useCallback(() => {
    if (typeof window === 'undefined') {
      setIsOpen(true);
      return;
    }
    const w = window.innerWidth;
    const margin = 12;
    const topSafe = 68;
    const isMobile = w < 768;
    const bottomSafe = isMobile ? 84 : 20;
    const panelW = Math.min(w - margin * 2, 380);
    const panelH = Math.min(window.innerHeight - topSafe - bottomSafe, 520);

    const openX = dockPos.side === 'right' ? w - panelW - margin : margin;
    const openY = dockPos.y - panelH / 2;

    const clamped = clampPanelPosition(openX, openY);
    setPanelPos({ x: clamped.x, y: clamped.y });
    setIsOpen(true);
  }, [dockPos, clampPanelPosition]);

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

  // Pointer tracking on collapsed dock: distinction between tap (< 6px) and drag
  const handleDockPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    pointerIsDraggingRef.current = false;
  };

  const handleDockPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStartPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y
    );
    if (dist >= 6) {
      pointerIsDraggingRef.current = true;
    }
  };

  const handleDockPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStartPosRef.current) return;
    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y
    );

    // If movement is under 6px, treat as a clean tap to open
    if (dist < 6 && !pointerIsDraggingRef.current) {
      pointerStartPosRef.current = null;
      pointerIsDraggingRef.current = false;
      handleOpenPanel();
      return;
    }

    pointerStartPosRef.current = null;
    pointerIsDraggingRef.current = false;
  };

  const handleDockDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: { point: { x: number; y: number } }
  ) => {
    const { w, minY, maxY } = getDockBounds();
    const side: 'left' | 'right' = info.point.x < w / 2 ? 'left' : 'right';
    const clampedY = Math.min(
      Math.max(minY, info.point.y - DOCK_SIZE / 2),
      maxY
    );
    const range = Math.max(1, maxY - minY);
    const yRatio = Math.min(Math.max((clampedY - minY) / range, 0), 1);

    const nextPos = { side, y: clampedY, yRatio };
    setDockPos(nextPos);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ side, yRatio, y: clampedY })
      );
    } catch {
      // Ignore storage errors
    }
  };

  const handlePanelDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: { point: { x: number; y: number } }
  ) => {
    const clamped = clampPanelPosition(info.point.x, info.point.y);
    setPanelPos({ x: clamped.x, y: clamped.y });
  };

  // SSR hydration gate
  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  const isLeft = dockPos.side === 'left';

  const portalContent = (
    <div className="ddoodle-assistant-root pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <AnimatePresence mode="wait">
        {!isOpen ? (
          // ===================================================================
          // COLLAPSED DOCK: SLEEK ICON-ONLY DOCK (NO TEXT)
          // 46px × 46px squircle/pill, edge-anchored radius, spring edge snap
          // ===================================================================
          <motion.div
            key="assistant-dock"
            drag
            dragMomentum={false}
            onDragEnd={handleDockDragEnd}
            animate={{
              y: dockPos.y,
              left: isLeft ? 10 : undefined,
              right: !isLeft ? 10 : undefined,
            }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="pointer-events-auto fixed top-0 select-none touch-none"
          >
            <button
              type="button"
              onPointerDown={handleDockPointerDown}
              onPointerMove={handleDockPointerMove}
              onPointerUp={handleDockPointerUp}
              aria-label="Open DD oodle Assistant"
              data-testid="assistant-docked-tab"
              className={`relative group flex h-[46px] w-[46px] min-h-[46px] min-w-[46px] items-center justify-center bg-theme-primary text-theme-primary-foreground shadow-lg shadow-theme-primary/25 ring-2 ring-white/25 dark:ring-slate-900/60 backdrop-blur-md transition-transform hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing ${
                isLeft
                  ? 'rounded-r-2xl rounded-l-md'
                  : 'rounded-l-2xl rounded-r-md'
              }`}
            >
              {/* Bot / Assistant Icon */}
              <BotMessageSquare className="h-5 w-5 text-theme-primary-foreground drop-shadow-sm" />

              {/* Tiny Pulsing Online / Ready Dot at Top Corner */}
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 ring-1 ring-white/60 dark:ring-slate-900" />
              </span>
            </button>
          </motion.div>
        ) : (
          // ===================================================================
          // EXPANDED PANEL: STRICT VIEWPORT CLAMPING & FLUID MORPH
          // Header-only drag, overscroll-contain, theme styled, zero overflow
          // ===================================================================
          <motion.div
            key="assistant-panel"
            drag
            dragControls={panelDragControls}
            dragListener={false}
            dragMomentum={false}
            onDragEnd={handlePanelDragEnd}
            initial={{
              opacity: 0,
              scale: 0.88,
              x: isLeft ? -20 : 20,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              x: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.88,
              x: isLeft ? -20 : 20,
            }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{
              left: panelPos.x,
              top: panelPos.y,
              transformOrigin: isLeft ? 'left center' : 'right center',
            }}
            role="dialog"
            aria-modal="false"
            aria-label={`${shortName} Assistant`}
            data-testid="assistant-widget-panel"
            className="pointer-events-auto fixed shadow-2xl rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-[min(380px,calc(100vw-24px))] max-h-[calc(100dvh-5rem)] flex flex-col z-[60]"
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

            {/* Chat Message History with Zero Scroll Seep-Through */}
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

            {/* Dynamic Clickable Topic Chips with Zero Scroll Seep-Through */}
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
