'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  FileText,
  Mail,
  MapPin,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';

export type LegalDocKey = 'terms' | 'privacy' | 'refund';

interface LegalMarkdownPageProps {
  docKey: LegalDocKey;
}

function isSafeMarkdownHref(rawHref: string): boolean {
  const trimmed = rawHref.trim();
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  );
}

/**
 * Pure React inline markdown parser (zero dangerouslySetInnerHTML).
 * Supports **bold**, *italic*, `code`, and [label](safe-url).
 */
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      const label = match[2];
      const href = match[3].trim();
      if (isSafeMarkdownHref(href)) {
        if (href.startsWith('/')) {
          tokens.push(
            <Link
              key={`${keyPrefix}-lnk-${idx++}`}
              href={href}
              className="font-semibold text-[var(--ps-accent)] hover:underline"
            >
              {label}
            </Link>
          );
        } else {
          tokens.push(
            <a
              key={`${keyPrefix}-ext-${idx++}`}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="font-semibold text-[var(--ps-accent)] hover:underline"
            >
              {label}
            </a>
          );
        }
      } else {
        tokens.push(label);
      }
    } else if (match[4]) {
      tokens.push(
        <strong
          key={`${keyPrefix}-b-${idx++}`}
          className="font-bold text-[var(--ps-text)]"
        >
          {match[4]}
        </strong>
      );
    } else if (match[5]) {
      tokens.push(
        <code
          key={`${keyPrefix}-c-${idx++}`}
          className="px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[12px] font-mono text-[var(--ps-text)]"
        >
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      tokens.push(
        <em key={`${keyPrefix}-i-${idx++}`} className="italic">
          {match[6]}
        </em>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

interface MarkdownBlock {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'p' | 'hr';
  lines: string[];
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const rawLines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push({ type: 'hr', lines: [] });
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', lines: [trimmed.slice(4).trim()] });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', lines: [trimmed.slice(3).trim()] });
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', lines: [trimmed.slice(2).trim()] });
      i++;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < rawLines.length && /^[-*•]\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', lines: items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', lines: items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== '' &&
      !rawLines[i].trim().startsWith('#') &&
      !/^[-*•]\s+/.test(rawLines[i].trim()) &&
      !/^\d+\.\s+/.test(rawLines[i].trim()) &&
      !/^---+$/.test(rawLines[i].trim())
    ) {
      paragraphLines.push(rawLines[i].trim());
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'p', lines: [paragraphLines.join(' ')] });
    }
  }

  return blocks;
}

const LEGAL_TABS: Array<{
  key: LegalDocKey;
  href: string;
  label: string;
  icon: typeof FileText;
}> = [
  {
    key: 'terms',
    href: '/legal/terms',
    label: 'Terms & Conditions',
    icon: FileText,
  },
  {
    key: 'privacy',
    href: '/legal/privacy',
    label: 'Privacy Policy',
    icon: ShieldCheck,
  },
  {
    key: 'refund',
    href: '/legal/refund-policy',
    label: 'Refund & Cancellation',
    icon: RotateCcw,
  },
];

export function LegalMarkdownPage({ docKey }: LegalMarkdownPageProps) {
  const { legal, identity, office } = useAppConfig();

  const markdown = useMemo(() => {
    if (docKey === 'terms') return legal.terms_md;
    if (docKey === 'privacy') return legal.privacy_md;
    return legal.refund_policy_md;
  }, [docKey, legal]);

  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);

  const formattedUpdated = useMemo(() => {
    const parsed = new Date(legal.updated_at);
    if (Number.isNaN(parsed.getTime())) return 'Recently updated';
    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [legal.updated_at]);

  return (
    <main
      data-testid={`legal-page-${docKey}`}
      className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 sm:py-10 space-y-6 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Top breadcrumb + Legal Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--ps-border)]">
        <div className="space-y-1">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to {identity.app_name}</span>
          </Link>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--ps-text-muted)]">
            <Calendar className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
            <span>Last updated: {formattedUpdated}</span>
          </div>
        </div>

        <nav
          aria-label="Legal policy pages"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
        >
          {LEGAL_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === docKey;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`h-8 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap border transition-colors ${
                  isActive
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)] shadow-2xs'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Rendered Markdown Article */}
      <article className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-8 space-y-4 shadow-2xs">
        {blocks.map((block, index) => {
          const key = `md-${index}`;
          switch (block.type) {
            case 'h1':
              return (
                <h1
                  key={key}
                  className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)] pb-2 border-b border-[var(--ps-border)]/70"
                >
                  {renderInlineMarkdown(block.lines[0], key)}
                </h1>
              );
            case 'h2':
              return (
                <h2
                  key={key}
                  className="text-base sm:text-lg font-bold tracking-tight text-[var(--ps-text)] pt-3"
                >
                  {renderInlineMarkdown(block.lines[0], key)}
                </h2>
              );
            case 'h3':
              return (
                <h3
                  key={key}
                  className="text-sm sm:text-base font-bold text-[var(--ps-text)] pt-2"
                >
                  {renderInlineMarkdown(block.lines[0], key)}
                </h3>
              );
            case 'ul':
              return (
                <ul
                  key={key}
                  className="list-disc pl-5 space-y-1.5 text-sm text-[var(--ps-text-muted)] leading-relaxed"
                >
                  {block.lines.map((item, itemIdx) => (
                    <li key={`${key}-li-${itemIdx}`}>
                      {renderInlineMarkdown(item, `${key}-li-${itemIdx}`)}
                    </li>
                  ))}
                </ul>
              );
            case 'ol':
              return (
                <ol
                  key={key}
                  className="list-decimal pl-5 space-y-1.5 text-sm text-[var(--ps-text-muted)] leading-relaxed"
                >
                  {block.lines.map((item, itemIdx) => (
                    <li key={`${key}-oli-${itemIdx}`}>
                      {renderInlineMarkdown(item, `${key}-oli-${itemIdx}`)}
                    </li>
                  ))}
                </ol>
              );
            case 'hr':
              return (
                <hr key={key} className="border-t border-[var(--ps-border)] my-4" />
              );
            case 'p':
            default:
              return (
                <p
                  key={key}
                  className="text-sm text-[var(--ps-text-muted)] leading-relaxed"
                >
                  {renderInlineMarkdown(block.lines[0], key)}
                </p>
              );
          }
        })}
      </article>

      {/* District Compliance & Support Footer Card */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-[var(--ps-text-muted)]">
          <div className="font-bold text-[var(--ps-text)]">
            {identity.app_name} — Local Support &amp; Grievance Desk
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              {office.address}
            </span>
            {office.email && (
              <a
                href={`mailto:${office.email}`}
                className="inline-flex items-center gap-1 font-semibold text-[var(--ps-accent)] hover:underline"
              >
                <Mail className="w-3.5 h-3.5" />
                {office.email}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/about"
            className="h-8 px-3 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center hover:bg-[var(--ps-surface-alt)] transition-colors"
          >
            About Us
          </Link>
          <Link
            href="/contact"
            className="h-8 px-3 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center hover:opacity-95 transition-opacity"
          >
            Contact Us
          </Link>
        </div>
      </section>
    </main>
  );
}
