'use client';

import React from 'react';
import { ExternalLink, Play } from 'lucide-react';

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapDoc {
  type: 'doc';
  content?: TiptapNode[];
}

export const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

/**
 * Strictly validates that a YouTube video ID is exactly 11 safe URL characters.
 */
export function isValidYouTubeVideoId(
  videoId: string | null | undefined
): videoId is string {
  return typeof videoId === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(videoId.trim());
}

/**
 * Sanitizes an external href to permit ONLY http://, https://, mailto:, and tel:.
 * Blocks javascript:, data:, vbscript:, and protocol-relative URLs.
 */
export function sanitizeBulletinHref(
  rawHref: string | null | undefined
): string | null {
  if (typeof rawHref !== 'string') return null;
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:')
  ) {
    // Reject embedded control characters or whitespace tricks
    if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;
    return trimmed;
  }

  return null;
}

function renderTextWithMarks(
  text: string,
  marks: TiptapMark[] | undefined,
  keyPrefix: string
): React.ReactNode {
  if (!marks || marks.length === 0) {
    return text;
  }

  return marks.reduce<React.ReactNode>((acc, mark, idx) => {
    const key = `${keyPrefix}-m-${idx}`;
    if (mark.type === 'bold' || mark.type === 'strong') {
      return (
        <strong key={key} className="font-semibold text-[var(--ps-text)]">
          {acc}
        </strong>
      );
    }
    if (mark.type === 'italic' || mark.type === 'em') {
      return (
        <em key={key} className="italic">
          {acc}
        </em>
      );
    }
    if (mark.type === 'link') {
      const safeHref = sanitizeBulletinHref(
        typeof mark.attrs?.href === 'string' ? mark.attrs.href : null
      );
      if (!safeHref) {
        return <React.Fragment key={key}>{acc}</React.Fragment>;
      }
      const isWeb = safeHref.startsWith('http://') || safeHref.startsWith('https://');
      return (
        <a
          key={key}
          href={safeHref}
          target={isWeb ? '_blank' : undefined}
          rel={isWeb ? 'noopener noreferrer nofollow' : undefined}
          className="inline-flex items-center gap-0.5 font-medium text-[var(--ps-accent)] underline underline-offset-2 hover:opacity-80 break-words"
        >
          <span>{acc}</span>
          {isWeb && <ExternalLink className="w-3 h-3 shrink-0 inline" aria-hidden="true" />}
        </a>
      );
    }
    return <React.Fragment key={key}>{acc}</React.Fragment>;
  }, text);
}

function renderNode(node: TiptapNode, key: string): React.ReactNode {
  if (!node || typeof node !== 'object') return null;

  switch (node.type) {
    case 'doc':
      return (
        <div key={key} className="space-y-3">
          {(node.content || []).map((child, idx) =>
            renderNode(child, `${key}-c-${idx}`)
          )}
        </div>
      );

    case 'paragraph': {
      const children = (node.content || []).map((child, idx) =>
        renderNode(child, `${key}-p-${idx}`)
      );
      if (children.length === 0) {
        return <p key={key} className="h-2" aria-hidden="true" />;
      }
      return (
        <p
          key={key}
          className="text-sm leading-relaxed text-[var(--ps-text)]/90 break-words"
        >
          {children}
        </p>
      );
    }

    case 'heading': {
      const rawLevel = Number(node.attrs?.level ?? 3);
      const level = Number.isFinite(rawLevel)
        ? Math.min(4, Math.max(1, Math.round(rawLevel)))
        : 3;
      const children = (node.content || []).map((child, idx) =>
        renderNode(child, `${key}-h-${idx}`)
      );

      if (level <= 2) {
        return (
          <h3
            key={key}
            className="text-base font-bold tracking-tight text-[var(--ps-text)] pt-1.5"
          >
            {children}
          </h3>
        );
      }
      return (
        <h4
          key={key}
          className="text-sm font-bold tracking-tight text-[var(--ps-text)] pt-1"
        >
          {children}
        </h4>
      );
    }

    case 'bulletList':
      return (
        <ul
          key={key}
          className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-[var(--ps-text)]/90 marker:text-[var(--ps-accent)]"
        >
          {(node.content || []).map((child, idx) =>
            renderNode(child, `${key}-ul-${idx}`)
          )}
        </ul>
      );

    case 'orderedList':
      return (
        <ol
          key={key}
          className="list-decimal pl-5 space-y-1.5 text-sm leading-relaxed text-[var(--ps-text)]/90 marker:font-semibold marker:text-[var(--ps-accent)]"
        >
          {(node.content || []).map((child, idx) =>
            renderNode(child, `${key}-ol-${idx}`)
          )}
        </ol>
      );

    case 'listItem':
      return (
        <li key={key} className="pl-0.5 [&>p]:my-0">
          {(node.content || []).map((child, idx) =>
            renderNode(child, `${key}-li-${idx}`)
          )}
        </li>
      );

    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]/60 rounded-r-xl px-3.5 py-2.5 text-sm italic text-[var(--ps-text-muted)] space-y-1.5"
        >
          {(node.content || []).map((child, idx) =>
            renderNode(child, `${key}-bq-${idx}`)
          )}
        </blockquote>
      );

    case 'hardBreak':
      return <br key={key} />;

    case 'horizontalRule':
      return <hr key={key} className="border-[var(--ps-border)] my-3" />;

    case 'text':
      return (
        <React.Fragment key={key}>
          {renderTextWithMarks(node.text || '', node.marks, key)}
        </React.Fragment>
      );

    default:
      // Safely render nested children for unknown non-HTML nodes without ever injecting raw HTML
      if (Array.isArray(node.content) && node.content.length > 0) {
        return (
          <div key={key} className="space-y-2">
            {node.content.map((child, idx) =>
              renderNode(child, `${key}-u-${idx}`)
            )}
          </div>
        );
      }
      return null;
  }
}

export interface BulletinContentRendererProps {
  content: TiptapDoc | TiptapNode | string | null | undefined;
  className?: string;
}

/**
 * XSS-safe React renderer for structured Tiptap / ProseMirror JSON documents.
 * Never uses dangerouslySetInnerHTML.
 */
export function BulletinContentRenderer({
  content,
  className = '',
}: BulletinContentRendererProps) {
  if (!content) {
    return (
      <p className={`text-sm text-[var(--ps-text-muted)] ${className}`}>
        No additional details provided.
      </p>
    );
  }

  if (typeof content === 'string') {
    return (
      <div className={`space-y-2 text-sm leading-relaxed text-[var(--ps-text)]/90 ${className}`}>
        {content.split(/\n{2,}/).map((para, idx) => (
          <p key={idx} className="break-words">
            {para}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="bulletin-content-renderer"
      className={`text-sm text-[var(--ps-text)] ${className}`}
    >
      {renderNode(content, 'root')}
    </div>
  );
}

export interface YouTubeEmbedPlayerProps {
  videoId: string | null | undefined;
  title?: string;
  className?: string;
}

/**
 * Sandboxed privacy-enhanced YouTube embed player.
 * Renders ONLY if videoId strictly matches /^[A-Za-z0-9_-]{11}$/.
 */
export function YouTubeEmbedPlayer({
  videoId,
  title = 'Bulletin video',
  className = '',
}: YouTubeEmbedPlayerProps) {
  if (!isValidYouTubeVideoId(videoId)) {
    return null;
  }

  const safeId = videoId.trim();
  const embedSrc = `https://www.youtube-nocookie.com/embed/${safeId}?rel=0&modestbranding=1`;

  return (
    <div
      data-testid="bulletin-youtube-embed"
      className={`rounded-xl overflow-hidden border border-[var(--ps-border)] bg-slate-950 ${className}`}
    >
      <div className="px-3 py-1.5 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ps-text-muted)]">
        <Play className="w-3.5 h-3.5 text-rose-500 shrink-0" aria-hidden="true" />
        <span className="truncate">Embedded Video</span>
      </div>
      <div className="relative w-full aspect-video">
        <iframe
          src={embedSrc}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      </div>
    </div>
  );
}

export default BulletinContentRenderer;
