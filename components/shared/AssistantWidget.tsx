'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
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
      'Use the Floating Map Toolbar and Category Filter pills to narrow listings across Churachandpur by category, locality, verification status, or keyword. Clicking any marker or cluster centers the map and opens the listing preview card.',
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
      'PrintSwift Local organizes records into core categories: Businesses, Services, Real Estate, Public Interest / Civic Places, Vehicles & Rentals, and Sports Facilities. All land and floor measurements default strictly to square metres (m²).',
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
      'Submitted listings enter the Admin Verification Queue where authorized officers inspect ownership documents, 360° panoramas, and non-cadastral boundary polygons before publishing.',
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
    text: `I am the local Helpbot for ${appName}. Tap one of the FAQ topics below—such as ${sampleSuggestions || 'Explore, Pick N Drop, or Payments'}—or reach our local support desk for personalized assistance.`,
    deepLinkUrl: '/contact',
  };
}

export function AssistantWidget() {
  const { helpbotFaqs, identity } = useAppConfig();
  const appName = identity.app_name?.trim() || 'PrintSwift Local';
  const shortName = identity.short_name?.trim() || 'PrintSwift';

  const activeTopics = useMemo(
    () => mapHelpbotRecordsToTopics(helpbotFaqs),
    [helpbotFaqs]
  );

  const welcomeMessage = useMemo<AssistantMessage>(
    () => ({
      id: 'welcome-0',
      sender: 'assistant',
      topicLabel: 'Platform Guide',
      text: `Hello! I am the ${shortName} Helpbot. Tap any quick FAQ topic below or ask about Explore, Pick N Drop, Vehicle Bookings, Payments, or Bulletins.`,
      timestamp: 'Just now',
    }),
    [shortName]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<AssistantMessage[]>([]);
  const counterRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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

  // Minimized (Docked) State: small floating tab clinging to the right edge of the screen
  if (!isOpen) {
    return (
      <div
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        aria-label={`Open ${shortName} Assistant`}
        data-testid="assistant-docked-tab"
        className="fixed right-0 top-1/2 -translate-y-1/2 w-3 h-16 bg-slate-300 dark:bg-slate-600 rounded-l-md cursor-pointer hover:w-5 transition-all z-[80]"
      />
    );
  }

  // Expanded (Window) State: Open full chatbox wrapped in motion.div drag dragMomentum={false}
  return (
    <motion.div
      drag
      dragMomentum={false}
      role="dialog"
      aria-modal="false"
      aria-label={`${shortName} Assistant Chatbot`}
      data-testid="assistant-widget-panel"
      className="fixed bottom-6 right-6 z-[90] shadow-2xl rounded-2xl overflow-hidden bg-[var(--ps-surface)] border border-[var(--ps-border)] w-[min(380px,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] flex flex-col"
    >
      {/* Drag handle at the top of the chat window */}
      <div className="w-full h-6 cursor-grab active:cursor-grabbing bg-[var(--ps-surface-alt)] flex items-center justify-center shrink-0">
        <div className="w-10 h-1 rounded-full bg-[var(--ps-border)]" />
      </div>

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 bg-[var(--ps-accent)] px-3 py-2 text-[var(--ps-accent-fg)] select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <MessageSquare className="h-3 w-3" />
          </div>
          <span className="text-xs font-semibold tracking-tight truncate">
            {shortName} Helpbot
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleResetChat}
            title="Reset conversation"
            aria-label="Reset conversation"
            data-testid="assistant-widget-reset-btn"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-80 hover:opacity-100 hover:bg-white/15 transition"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title={`Close ${shortName} Helpbot`}
            aria-label={`Close ${shortName} Helpbot`}
            data-testid="assistant-widget-close-btn"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-80 hover:opacity-100 hover:bg-white/15 transition"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Security / Deterministic Banner */}
      <div className="flex items-center gap-1.5 border-b border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-[11px] text-[var(--ps-text-muted)] shrink-0">
        <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="truncate">
          Live {appName} FAQ answers — instant &amp; offline-friendly.
        </span>
      </div>

      {/* Chat Message History */}
      <div
        ref={scrollContainerRef}
        data-testid="assistant-widget-messages"
        className="flex-1 min-h-[160px] sm:max-h-64 overflow-y-auto space-y-2.5 bg-[var(--ps-bg)]/60 p-3.5"
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
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs space-y-2 ${
                  msg.sender === 'user'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] rounded-br-xs'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] rounded-bl-xs'
                }`}
              >
                {msg.sender === 'assistant' && msg.topicLabel && (
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="truncate">{msg.topicLabel}</span>
                  </div>
                )}
                <p>{msg.text}</p>
                {msg.sender === 'assistant' && safeUrl && (
                  <div className="pt-0.5">
                    {isInternal ? (
                      <Link
                        href={safeUrl}
                        onClick={() => setIsOpen(false)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[var(--ps-accent)]/12 border border-[var(--ps-accent)]/30 text-[11px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-colors"
                      >
                        <span>Open Page</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[var(--ps-accent)]/12 border border-[var(--ps-accent)]/30 text-[11px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-colors"
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
      <div className="border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5 shrink-0">
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-text-muted)]">
          <HelpCircle className="h-3 w-3 text-[var(--ps-accent)]" />
          <span>Quick FAQ Topics</span>
        </div>
        <div
          data-testid="assistant-widget-topic-chips"
          className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar"
        >
          {activeTopics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              data-testid={`assistant-topic-chip-${topic.id}`}
              onClick={() => appendInteraction(topic.label)}
              className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/80 px-2.5 py-1 text-left text-[11px] font-semibold text-[var(--ps-text)] transition hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-accent)]/10"
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
        className="flex items-center gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 shrink-0"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about Pick N Drop, vehicles, UPI..."
          aria-label={`Ask ${shortName} Helpbot a question`}
          data-testid="assistant-widget-input"
          className="h-9 flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
        />
        <button
          type="submit"
          disabled={!inputValue.trim()}
          aria-label="Send question"
          data-testid="assistant-widget-send-btn"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </motion.div>
  );
}

export default AssistantWidget;
