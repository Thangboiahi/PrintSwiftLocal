'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading4,
  RemoveFormatting,
  Sparkles,
} from 'lucide-react';
import {
  sanitizeRichTextHtml,
  stripRichTextToPlain,
} from '@/lib/utils/sanitize-rich-text';

export interface RichTextEditorProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (sanitizedHtml: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  minRows?: number;
  helperText?: string;
  error?: string;
  testId?: string;
  className?: string;
}

/**
 * Custom-UI Rich Text Editor matching DD oodle's 3-tier CSS theme variables.
 * Toolbar supports: Bold, Italic, Bullet List, Numbered List, Section Heading (H4),
 * and Clear Formatting, plus live character/word counter.
 * Emits sanitized HTML via `sanitizeRichTextHtml`.
 */
export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  placeholder = 'Write a clear, helpful description...',
  required = false,
  disabled = false,
  maxLength = 4000,
  minRows = 4,
  helperText,
  error,
  testId = 'rich-text-editor',
  className = '',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastEmittedRef = useRef<string>('');

  // Initialize & sync external value changes without clobbering active cursor
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incomingSanitized = sanitizeRichTextHtml(value);
    if (incomingSanitized !== lastEmittedRef.current && !isFocused) {
      el.innerHTML = incomingSanitized;
      lastEmittedRef.current = incomingSanitized;
    }
  }, [value, isFocused]);

  const plainStats = useMemo(() => {
    const plain = stripRichTextToPlain(value);
    const chars = plain.length;
    const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
    return { chars, words, plain };
  }, [value]);

  const emitCurrentHtml = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const rawHtml = el.innerHTML;
    const sanitized = sanitizeRichTextHtml(rawHtml);
    lastEmittedRef.current = sanitized;
    onChange(sanitized);
  }, [onChange]);

  const execCommand = (command: string, commandValue?: string) => {
    if (disabled) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false, commandValue);
    } catch {
      // Fallback no-op if browser blocks execCommand
    }
    emitCurrentHtml();
  };

  const handleClearFormatting = () => {
    if (disabled) return;
    const el = editorRef.current;
    if (!el) return;
    const plain = stripRichTextToPlain(el.innerHTML);
    const cleanHtml = sanitizeRichTextHtml(plain);
    el.innerHTML = cleanHtml;
    lastEmittedRef.current = cleanHtml;
    onChange(cleanHtml);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const htmlData = e.clipboardData.getData('text/html');
    const textData = e.clipboardData.getData('text/plain');
    const safeInsert = sanitizeRichTextHtml(htmlData || textData);
    try {
      document.execCommand('insertHTML', false, safeInsert);
    } catch {
      document.execCommand('insertText', false, textData);
    }
    emitCurrentHtml();
  };

  const minHeightPx = Math.max(minRows * 24, 96);

  return (
    <div className={`w-full ${className}`} data-testid={testId}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label
            htmlFor={id}
            className="block text-xs font-bold text-[var(--text-primary,var(--ps-text))]"
          >
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted,var(--ps-text-muted))]">
            <Sparkles className="h-3 w-3 text-[var(--brand-primary,var(--ps-accent))]" />
            Rich Text
          </span>
        </div>
      )}

      <div
        className={`overflow-hidden rounded-2xl border transition-all ${
          error
            ? 'border-rose-500/80 ring-1 ring-rose-500/20'
            : isFocused
              ? 'border-[var(--brand-primary,var(--ps-accent))] ring-2 ring-[var(--brand-primary,var(--ps-accent))]/20'
              : 'border-[var(--border-subtle,var(--ps-border))]'
        } bg-[var(--bg-surface,var(--ps-surface))] ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {/* Custom Formatting Toolbar */}
        <div
          role="toolbar"
          aria-label="Text formatting toolbar"
          className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border-subtle,var(--ps-border))] bg-[var(--bg-elevated,var(--ps-bg-subtle))] px-2 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => execCommand('bold')}
              title="Bold"
              aria-label="Bold"
              data-testid={`${testId}-btn-bold`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary,var(--ps-text))] hover:bg-[var(--brand-primary,var(--ps-accent))]/15 hover:text-[var(--brand-primary,var(--ps-accent))] transition-colors"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => execCommand('italic')}
              title="Italic"
              aria-label="Italic"
              data-testid={`${testId}-btn-italic`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary,var(--ps-text))] hover:bg-[var(--brand-primary,var(--ps-accent))]/15 hover:text-[var(--brand-primary,var(--ps-accent))] transition-colors"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle,var(--ps-border))]" />
            <button
              type="button"
              onClick={() => execCommand(' formatBlock', 'H4')}
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('formatBlock', '<h4>');
              }}
              title="Section Heading"
              aria-label="Section Heading"
              data-testid={`${testId}-btn-h4`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary,var(--ps-text))] hover:bg-[var(--brand-primary,var(--ps-accent))]/15 hover:text-[var(--brand-primary,var(--ps-accent))] transition-colors"
            >
              <Heading4 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => execCommand('insertUnorderedList')}
              title="Bullet List"
              aria-label="Bullet List"
              data-testid={`${testId}-btn-ul`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary,var(--ps-text))] hover:bg-[var(--brand-primary,var(--ps-accent))]/15 hover:text-[var(--brand-primary,var(--ps-accent))] transition-colors"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => execCommand('insertOrderedList')}
              title="Numbered List"
              aria-label="Numbered List"
              data-testid={`${testId}-btn-ol`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary,var(--ps-text))] hover:bg-[var(--brand-primary,var(--ps-accent))]/15 hover:text-[var(--brand-primary,var(--ps-accent))] transition-colors"
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle,var(--ps-border))]" />
            <button
              type="button"
              onClick={handleClearFormatting}
              title="Clear Formatting"
              aria-label="Clear Formatting"
              data-testid={`${testId}-btn-clear`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted,var(--ps-text-muted))] hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
            >
              <RemoveFormatting className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Live Character & Word Counter */}
          <div
            data-testid={`${testId}-counter`}
            className={`px-1.5 text-[10px] font-bold tabular-nums ${
              maxLength && plainStats.chars > maxLength
                ? 'text-rose-500'
                : 'text-[var(--text-muted,var(--ps-text-muted))]'
            }`}
          >
            {plainStats.words} {plainStats.words === 1 ? 'word' : 'words'} · {plainStats.chars}
            {maxLength ? `/${maxLength}` : ''} chars
          </div>
        </div>

        {/* Editable Content Area */}
        <div className="relative">
          {plainStats.chars === 0 && !isFocused && (
            <div className="pointer-events-none absolute left-3.5 top-3 text-xs text-[var(--text-muted,var(--ps-text-muted))]">
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            id={id}
            role="textbox"
            aria-multiline="true"
            aria-label={label || placeholder}
            contentEditable={!disabled}
            suppressContentEditableWarning
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              emitCurrentHtml();
            }}
            onInput={emitCurrentHtml}
            onPaste={handlePaste}
            style={{ minHeight: `${minHeightPx}px` }}
            data-testid={`${testId}-content`}
            className="w-full px-3.5 py-2.5 text-xs leading-relaxed text-[var(--text-primary,var(--ps-text))] outline-none [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-extrabold [&_p]:mb-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5 [&_strong]:font-bold [&_em]:italic"
          />
        </div>
      </div>

      {error ? (
        <p className="mt-1 text-[11px] font-medium text-rose-500">{error}</p>
      ) : helperText ? (
        <p className="mt-1 text-[10px] text-[var(--text-muted,var(--ps-text-muted))]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Safe read-only React renderer for Rich Text content created by `<RichTextEditor />`
 * (zero `dangerouslySetInnerHTML` — renders sanitized allowlisted tags into React nodes).
 */
function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function renderSanitizedHtmlNodes(safeHtml: string): React.ReactNode[] {
  interface StackFrame {
    tag: string;
    children: React.ReactNode[];
  }
  const root: StackFrame = { tag: 'root', children: [] };
  const stack: StackFrame[] = [root];
  const tokenRegex = /<\/?(p|br|strong|em|ul|ol|li|h4)>/gi;
  let lastIndex = 0;
  let keyCounter = 0;

  const pushText = (rawText: string) => {
    if (!rawText) return;
    stack[stack.length - 1].children.push(decodeBasicEntities(rawText));
  };

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(safeHtml)) !== null) {
    if (match.index > lastIndex) {
      pushText(safeHtml.slice(lastIndex, match.index));
    }
    const rawToken = match[0];
    const tag = match[1].toLowerCase();
    const isClosing = rawToken.startsWith('</');

    if (tag === 'br') {
      if (!isClosing) {
        stack[stack.length - 1].children.push(<br key={`br-${keyCounter++}`} />);
      }
    } else if (!isClosing) {
      stack.push({ tag, children: [] });
    } else {
      let popIdx = stack.length - 1;
      while (popIdx > 0 && stack[popIdx].tag !== tag) {
        popIdx--;
      }
      if (popIdx > 0) {
        while (stack.length - 1 >= popIdx) {
          const frame = stack.pop()!;
          const Tag = frame.tag as 'p' | 'strong' | 'em' | 'ul' | 'ol' | 'li' | 'h4';
          stack[stack.length - 1].children.push(
            <Tag key={`${Tag}-${keyCounter++}`}>{frame.children}</Tag>
          );
        }
      }
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < safeHtml.length) {
    pushText(safeHtml.slice(lastIndex));
  }

  while (stack.length > 1) {
    const frame = stack.pop()!;
    const Tag = frame.tag as 'p' | 'strong' | 'em' | 'ul' | 'ol' | 'li' | 'h4';
    stack[stack.length - 1].children.push(
      <Tag key={`${Tag}-${keyCounter++}`}>{frame.children}</Tag>
    );
  }

  return root.children;
}

export function RichTextDisplay({
  html,
  className = '',
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const safeNodes = useMemo(() => {
    const safeHtml = sanitizeRichTextHtml(html);
    return safeHtml ? renderSanitizedHtmlNodes(safeHtml) : null;
  }, [html]);
  if (!safeNodes) return null;
  return (
    <div
      className={`text-xs leading-relaxed text-[var(--text-primary,var(--ps-text))] [&_h4]:mt-2.5 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-extrabold [&_p]:mb-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5 [&_strong]:font-bold [&_em]:italic ${className}`}
    >
      {safeNodes}
    </div>
  );
}

export default RichTextEditor;
