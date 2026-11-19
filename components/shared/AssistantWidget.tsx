'use client';

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  HelpCircle,
  MessageSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

export interface AssistantFaqTopic {
  id: string;
  label: string;
  keywords: string[];
  response: string;
}

interface AssistantMessage {
  id: string;
  sender: 'assistant' | 'user';
  topicLabel?: string;
  text: string;
  timestamp: string;
}

export const DETERMINISTIC_FAQ_TOPICS: AssistantFaqTopic[] = [
  {
    id: 'map-filters',
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
      'Use the Floating Map Toolbar and Category Filter pills to narrow listings across Churachandpur by category, locality, verification status, or keyword. Clicking any marker or cluster centers the map and opens the listing preview card. Toggle "Real Estate Mode" to inspect property boundary polygons and price/area labels, or enable "Simple Mode" to hide advanced Terra Draw measurement tools.',
  },
  {
    id: 'categories-sample-rules',
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
      'PrintSwift Local organizes records into core categories: Businesses, Services, Real Estate, Public Interest / Civic Places, and Sports Facilities. All land and floor measurements default strictly to square metres (m²), with instant conversion to sq ft, acres, or hectares. Unverified records display clear sample/verification badges until approved by an officer.',
  },
  {
    id: 'real-estate-panorama',
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
      'Every Real Estate listing (plots, houses, villas, apartments, or commercial properties) must include at least one valid 2:1 equirectangular 360° panorama before it can be published. Listings without a 360° panorama can be saved as incomplete drafts or imported via CSV as drafts, but publication is automatically gated until a 360° tour is attached.',
  },
  {
    id: 'moderation-verification',
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
      'Submitted listings enter the Admin Verification Queue where authorized officers (across the 7-tier least-privilege role model) inspect ownership documents, 360° panoramas, and non-cadastral boundary polygons. Officers can Approve, Request Changes, or Reject single or bulk rows, as well as perform bulk CSV imports and exports from the Administrator Command Centre.',
  },
];

function resolveDeterministicReply(query: string): {
  topicLabel?: string;
  text: string;
} {
  const normalized = query.trim().toLowerCase();

  // Exact match on pre-defined topic label
  const exactTopic = DETERMINISTIC_FAQ_TOPICS.find(
    (t) => t.label.toLowerCase() === normalized
  );
  if (exactTopic) {
    return {
      topicLabel: exactTopic.label,
      text: exactTopic.response,
    };
  }

  // Guardrail for write/mutation requests
  if (
    normalized.includes('delete ') ||
    normalized.includes('approve my') ||
    normalized.includes('change my role') ||
    normalized.includes('reset database')
  ) {
    return {
      topicLabel: 'Read-Only Guardrail',
      text: 'PrintSwift Assistant is a deterministic, read-only guide and never modifies database records or permissions directly. Please use the Owner, Staff, or Admin Workspace controls to perform account or listing actions.',
    };
  }

  // Keyword scoring across deterministic FAQ entries
  let bestTopic: AssistantFaqTopic | null = null;
  let bestScore = 0;

  for (const topic of DETERMINISTIC_FAQ_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (normalized.includes(kw)) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  if (bestTopic && bestScore > 0) {
    return {
      topicLabel: bestTopic.label,
      text: bestTopic.response,
    };
  }

  return {
    topicLabel: 'Local Knowledge Base',
    text: 'I am a local deterministic assistant for PrintSwift Local. Select one of the topic chips below—such as "How to use the Map & Filters", "Listing Categories & Sample Data rules", "Real Estate 360° Panorama requirements", or "Moderation & Verification process"—for immediate guidance.',
  };
}

const INITIAL_WELCOME_MESSAGE: AssistantMessage = {
  id: 'welcome-0',
  sender: 'assistant',
  topicLabel: 'Platform Guide',
  text: 'Hello! I am the PrintSwift Assistant. Choose any topic chip below or type a question about map filters, listing categories, 360° panoramas, or verification workflows.',
  timestamp: 'Just now',
};

export function AssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([
    INITIAL_WELCOME_MESSAGE,
  ]);
  const counterRef = useRef(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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

    const resolved = resolveDeterministicReply(trimmed);
    const botMessage: AssistantMessage = {
      id: `bot-${seq}`,
      sender: 'assistant',
      topicLabel: resolved.topicLabel,
      text: resolved.text,
      timestamp: 'Now',
    };

    setMessages((prev) => [...prev, userMessage, botMessage]);
    setInputValue('');

    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
    }, 30);
  };

  const handleResetChat = () => {
    setMessages([INITIAL_WELCOME_MESSAGE]);
    setInputValue('');
  };

  // Minimized (Docked) State: When collapsed, render it as a small floating tab clinging to the right edge of the screen
  if (!isOpen) {
    return (
      <div
        onClick={() => setIsOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Open PrintSwift Assistant"
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
      aria-label="PrintSwift Assistant Chatbot"
      data-testid="assistant-widget-panel"
      className="fixed bottom-6 right-6 z-[90] shadow-2xl rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-[min(380px,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] flex flex-col"
    >
      {/* Drag handle at the top of the chat window */}
      <div className="w-full h-6 cursor-grab active:cursor-grabbing bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
        <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
      </div>

      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 bg-sky-600 px-3 py-2 text-white select-none shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <MessageSquare className="h-3 w-3" />
          </div>
          <span className="text-xs font-semibold tracking-tight text-white/95 truncate">
            PrintSwift Assistant
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleResetChat}
            title="Reset conversation"
            aria-label="Reset conversation"
            data-testid="assistant-widget-reset-btn"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/75 hover:text-white hover:bg-white/15 transition"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title="Close PrintSwift Assistant"
            aria-label="Close PrintSwift Assistant"
            data-testid="assistant-widget-close-btn"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/75 hover:text-white hover:bg-white/15 transition"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Security / Deterministic Banner */}
        <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
          <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate">
            Instant local FAQ responses — no external AI API key required.
          </span>
        </div>

        {/* Chat Message History */}
        <div
          ref={scrollContainerRef}
          data-testid="assistant-widget-messages"
          className="flex-1 min-h-[160px] sm:max-h-64 overflow-y-auto space-y-2.5 bg-slate-50/60 dark:bg-slate-950/50 p-3.5"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs ${
                  msg.sender === 'user'
                    ? 'bg-sky-600 text-white rounded-br-xs'
                    : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-bl-xs'
                }`}
              >
                {msg.sender === 'assistant' && msg.topicLabel && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                    <Sparkles className="h-3 w-3" />
                    <span>{msg.topicLabel}</span>
                  </div>
                )}
                <p>{msg.text}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pre-defined Clickable Topic Chips */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 shrink-0">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <HelpCircle className="h-3 w-3 text-sky-600 dark:text-sky-400" />
            <span>Quick FAQ Topics</span>
          </div>
          <div
            data-testid="assistant-widget-topic-chips"
            className="flex flex-wrap gap-1.5"
          >
            {DETERMINISTIC_FAQ_TOPICS.map((topic) => (
              <button
                key={topic.id}
                type="button"
                data-testid={`assistant-topic-chip-${topic.id}`}
                onClick={() => appendInteraction(topic.label)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-800 dark:text-slate-200 transition hover:border-sky-500/50 hover:bg-sky-500/10"
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
            placeholder="Ask about map filters, 360° tours..."
            aria-label="Ask PrintSwift Assistant a question"
            data-testid="assistant-widget-input"
            className="min-h-[38px] flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            aria-label="Send question"
            data-testid="assistant-widget-send-btn"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl bg-sky-600 p-2 text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </motion.div>
  );
}

export default AssistantWidget;
