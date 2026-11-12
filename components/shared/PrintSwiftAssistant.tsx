'use client';

import React, { useMemo, useState } from 'react';
import {
  HelpCircle,
  MessageSquare,
  Minimize2,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

interface ChatMessage {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
}

interface KnowledgeEntry {
  keywords: string[];
  question: string;
  answer: string;
  roles: Array<'visitor' | 'owner' | 'staff' | 'admin'>;
}

const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    keywords: ['map', 'select', 'marker', 'card', 'side panel', 'list'],
    question: 'How does selecting a listing on the map work?',
    answer:
      'When no listing is selected, the side panel displays all listings currently inside the visible map viewport matching your filters. When you select a marker or listing card, the side list is hidden and replaced with the Selected Listing Card, and the map centres the marker in the unobstructed area. Clicking "Clear Selection" restores your previous list and filters.',
    roles: ['visitor', 'owner', 'staff', 'admin'],
  },
  {
    keywords: ['panorama', '360', 'real estate', 'mandatory', 'business'],
    question: 'Why is a 360° panorama compulsory for real estate?',
    answer:
      'In PrintSwift Local, every real-estate listing (whether a plot, house, villa, apartment, commercial unit, or PG) must have at least one valid 2:1 equirectangular 360° panorama before it can be submitted for publication. Incomplete drafts can be saved without one. Businesses and shops do NOT require a 360° panorama.',
    roles: ['visitor', 'owner', 'staff', 'admin'],
  },
  {
    keywords: ['area', 'unit', 'm2', 'sqm', 'square metres', 'plot', 'apartment'],
    question: 'Which property types show plot area and boundary polygons?',
    answer:
      'Square metres (m²) is the mandatory default unit across the platform (with optional conversion to ft², acres, or hectares). Plot area and interactive land-boundary polygon tools appear ONLY for Plots/Land and Houses/Villas with an associated plot. Apartments, houses without plots, and rooms/PGs do not display irrelevant plot polygons.',
    roles: ['visitor', 'owner', 'staff', 'admin'],
  },
  {
    keywords: ['draw', 'measure', 'polygon', 'radius', 'search'],
    question: 'How do the map drawing and area search tools work?',
    answer:
      'Use the Map Drawing Toolbar on the discovery map to place points, lines, polygons, rectangles, or circles. Measurements are calculated in m² and metres using Turf.js. You can filter visible listings inside your drawn polygon or radius, and clear all sample shapes at any time.',
    roles: ['visitor', 'owner', 'staff', 'admin'],
  },
  {
    keywords: ['theme', 'dark', 'map style', 'independent'],
    question: 'Are the website theme and map style independent?',
    answer:
      'Yes. In Appearance Settings, you can choose System, Light, or Dark mode plus 5 colour presets (Minimal Neutral, Ocean, Forest, Slate, Warm Clay) for the website interface, while choosing Roadmap, Dark Map, Satellite, Hybrid, or Terrain independently for the map.',
    roles: ['visitor', 'owner', 'staff', 'admin'],
  },
  {
    keywords: ['catalogue', 'product', 'checkout', 'order'],
    question: 'How do business product catalogues work in this prototype?',
    answer:
      'Business listings include searchable and filterable product catalogues with sample prices, variants, and availability labels. Because this is a private prototype, commercial checkout, cart payment, and order processing are intentionally disabled.',
    roles: ['visitor', 'owner', 'staff'],
  },
  {
    keywords: ['staff', 'delegate', 'permission', 'owner'],
    question: 'How does delegated staff access work for listing owners?',
    answer:
      'In the Owner Workspace under "Staff & Delegation", owners can assign specific listings and granular permissions (such as Edit Details, Manage Catalogue, or Reply to Enquiries) to staff accounts. When you switch to a Staff role, only assigned listings and permitted actions are enabled.',
    roles: ['owner', 'staff', 'admin'],
  },
  {
    keywords: ['verification', 'moderation', 'geo', 'admin', 'xlsx', 'excel'],
    question: 'What tools are available in the Admin Command Centre?',
    answer:
      'Administrators can manage users across 7 least-privilege admin roles, review verification evidence, resolve moderation cases, correct misplaced geographic pins, configure dynamic category fields, and export filtered tables to genuine .xlsx workbooks or .csv files.',
    roles: ['admin'],
  },
];

export function PrintSwiftAssistant() {
  const { currentUser } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState('');
  const msgCounterRef = React.useRef(1);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Welcome to PrintSwift Assistant (Read-Only Prototype Guide). Ask me about map navigation, real-estate m² & 360° panorama rules, owner tools, or admin workflows.',
    },
  ]);

  const suggestedQuestions = useMemo(() => {
    return KNOWLEDGE_BASE.filter((k) =>
      k.roles.includes(currentUser.roleType)
    ).slice(0, 4);
  }, [currentUser.roleType]);

  const handleAsk = (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed) return;

    const seq = msgCounterRef.current++;
    const userMsg: ChatMessage = {
      id: `u-${seq}`,
      sender: 'user',
      text: trimmed,
    };

    const lower = trimmed.toLowerCase();
    let replyText = '';

    // Check if user asks the chatbot to perform a write action
    if (
      lower.includes('approve my') ||
      lower.includes('delete ') ||
      lower.includes('change role') ||
      lower.includes('publish my') ||
      lower.includes('book ')
    ) {
      replyText =
        'I am a read-only in-app guide and cannot approve listings, modify records, change roles, or place bookings on your behalf. Please use the Owner or Admin workspace controls directly to perform that action.';
    } else {
      const matched = KNOWLEDGE_BASE.find((entry) =>
        entry.keywords.some((kw) => lower.includes(kw)) ||
        entry.question.toLowerCase() === lower
      );
      if (matched) {
        replyText = matched.answer;
      } else {
        replyText =
          'I could not find an exact match in the local help knowledge base for that query. Try asking about: (1) Map marker selection & full-screen mode, (2) Real-estate m² area rules & mandatory 360° panoramas, (3) Business catalogues & owner enquiries, or (4) Admin verification, moderation & Excel (.xlsx) exports.';
      }
    }

    const botMsg: ChatMessage = {
      id: `b-${seq}`,
      sender: 'assistant',
      text: replyText,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInput('');
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        aria-label="Open PrintSwift Assistant help guide"
        data-testid="assistant-toggle-btn"
        className="hidden lg:inline-flex fixed bottom-4 right-4 z-30 items-center gap-2 px-3.5 py-2 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-lg hover:opacity-95 transition-opacity text-xs font-semibold"
      >
        <HelpCircle className="w-4 h-4" />
        <span>PrintSwift Assistant</span>
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-16 lg:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-40 sm:w-96 bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
      role="region"
      aria-label="PrintSwift Assistant Help Panel"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 shrink-0" />
          <div className="truncate">
            <div className="text-xs font-semibold">PrintSwift Assistant</div>
            <div className="text-[10px] opacity-80">
              Contextual Guide ({currentUser.roleType.toUpperCase()} View) · Read-Only
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsMinimized((p) => !p)}
            aria-label={isMinimized ? 'Expand assistant' : 'Minimise assistant'}
            className="p-1 rounded hover:bg-white/10"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close PrintSwift Assistant"
            className="p-1 rounded hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="px-3 py-1.5 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Deterministic offline guide — never modifies records or exposes private data.</span>
          </div>

          {/* Messages */}
          <div className="p-3.5 space-y-3 max-h-72 overflow-y-auto bg-[var(--ps-bg)]">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${
                  m.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)]'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* Suggested Questions */}
          <div className="px-3.5 py-2.5 border-t border-[var(--ps-border)] bg-[var(--ps-surface)]">
            <p className="text-[11px] font-medium text-[var(--ps-text-muted)] mb-1.5">
              Suggested questions for {currentUser.roleType}:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedQuestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAsk(item.question)}
                  className="text-left text-[11px] px-2.5 py-1 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-text)] hover:opacity-85 transition-opacity"
                >
                  {item.question}
                </button>
              ))}
            </div>
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk(input);
            }}
            className="p-2.5 border-t border-[var(--ps-border)] bg-[var(--ps-surface)] flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask how a feature works..."
              aria-label="Ask PrintSwift Assistant a question"
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
            <button
              type="submit"
              aria-label="Send question"
              className="p-2 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-90"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
