'use client';

import React, { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Check,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import {
  sanitizeBulletinHref,
  type TiptapDoc,
} from '@/components/bulletin/BulletinContentRenderer';

export interface BulletinEditorProps {
  initialContent?: TiptapDoc | null;
  placeholder?: string;
  onChange: (json: TiptapDoc, plainText: string) => void;
  disabled?: boolean;
}

export function BulletinEditor({
  initialContent = null,
  placeholder = 'Write your announcement, job details, requirements, or event schedule...',
  onChange,
  disabled = false,
}: BulletinEditorProps) {
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: initialContent || {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON() as TiptapDoc, instance.getText());
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[150px] max-h-[280px] overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-[var(--ps-text)] focus:outline-none',
        'aria-label': 'Bulletin content editor',
        'data-testid': 'bulletin-tiptap-editor',
      },
    },
  });

  const handleOpenLinkBar = () => {
    if (!editor) return;
    const existingHref = editor.getAttributes('link').href as string | undefined;
    setLinkUrlInput(existingHref || 'https://');
    setLinkError(null);
    setIsLinkInputOpen(true);
  };

  const handleApplyLink = () => {
    if (!editor) return;
    const safeHref = sanitizeBulletinHref(linkUrlInput);
    if (!safeHref) {
      setLinkError('Enter a valid http://, https://, mailto:, or tel: link.');
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: safeHref })
      .run();
    setIsLinkInputOpen(false);
    setLinkUrlInput('');
    setLinkError(null);
  };

  const handleRemoveLink = () => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setIsLinkInputOpen(false);
    setLinkError(null);
  };

  const btnClass = (active: boolean) =>
    `h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors ${
      active
        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
    } disabled:opacity-40`;

  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ps-ring)]">
      {/* Compact High-Density Formatting Toolbar (h-7 buttons) */}
      <div
        role="toolbar"
        aria-label="Rich text formatting"
        className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50"
      >
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor || disabled}
          title="Bold"
          aria-label="Bold"
          aria-pressed={editor?.isActive('bold') ?? false}
          className={btnClass(Boolean(editor?.isActive('bold')))}
        >
          <Bold className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor || disabled}
          title="Italic"
          aria-label="Italic"
          aria-pressed={editor?.isActive('italic') ?? false}
          className={btnClass(Boolean(editor?.isActive('italic')))}
        >
          <Italic className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <span className="w-px h-4 bg-[var(--ps-border)] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!editor || disabled}
          title="Heading 2"
          aria-label="Heading 2"
          aria-pressed={editor?.isActive('heading', { level: 2 }) ?? false}
          className={btnClass(Boolean(editor?.isActive('heading', { level: 2 })))}
        >
          <Heading2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          disabled={!editor || disabled}
          title="Heading 3"
          aria-label="Heading 3"
          aria-pressed={editor?.isActive('heading', { level: 3 }) ?? false}
          className={btnClass(Boolean(editor?.isActive('heading', { level: 3 })))}
        >
          <Heading3 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <span className="w-px h-4 bg-[var(--ps-border)] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!editor || disabled}
          title="Bullet List"
          aria-label="Bullet List"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          className={btnClass(Boolean(editor?.isActive('bulletList')))}
        >
          <List className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!editor || disabled}
          title="Numbered List"
          aria-label="Numbered List"
          aria-pressed={editor?.isActive('orderedList') ?? false}
          className={btnClass(Boolean(editor?.isActive('orderedList')))}
        >
          <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          disabled={!editor || disabled}
          title="Blockquote"
          aria-label="Blockquote"
          aria-pressed={editor?.isActive('blockquote') ?? false}
          className={btnClass(Boolean(editor?.isActive('blockquote')))}
        >
          <Quote className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        <span className="w-px h-4 bg-[var(--ps-border)] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={handleOpenLinkBar}
          disabled={!editor || disabled}
          title="Add or Edit Link"
          aria-label="Add or Edit Link"
          aria-pressed={Boolean(editor?.isActive('link')) || isLinkInputOpen}
          className={btnClass(Boolean(editor?.isActive('link')) || isLinkInputOpen)}
        >
          <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>

        {editor?.isActive('link') && (
          <button
            type="button"
            onClick={handleRemoveLink}
            disabled={disabled}
            title="Remove Link"
            aria-label="Remove Link"
            className={btnClass(false)}
          >
            <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => editor?.chain().focus().undo().run()}
            disabled={!editor || disabled || !editor.can().undo()}
            title="Undo"
            aria-label="Undo"
            className={btnClass(false)}
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().redo().run()}
            disabled={!editor || disabled || !editor.can().redo()}
            title="Redo"
            aria-label="Redo"
            className={btnClass(false)}
          >
            <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Inline Safe Link Input Bar */}
      {isLinkInputOpen && (
        <div className="px-2.5 py-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] space-y-1">
          <div className="flex items-center gap-1.5">
            <input
              type="url"
              value={linkUrlInput}
              onChange={(e) => {
                setLinkUrlInput(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyLink();
                } else if (e.key === 'Escape') {
                  setIsLinkInputOpen(false);
                }
              }}
              placeholder="https://example.com"
              className="flex-1 h-7 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-1 focus:ring-[var(--ps-accent)]"
            />
            <button
              type="button"
              onClick={handleApplyLink}
              className="h-7 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply</span>
            </button>
            <button
              type="button"
              onClick={() => setIsLinkInputOpen(false)}
              aria-label="Close link input"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {linkError && (
            <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {linkError}
            </p>
          )}
        </div>
      )}

      {/* Tiptap ProseMirror Surface */}
      <div className="[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-2 [&_.ProseMirror_h2]:mb-1 [&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-1.5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-1.5 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--ps-accent)] [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_blockquote]:text-[var(--ps-text-muted)] [&_.ProseMirror_a]:text-[var(--ps-accent)] [&_.ProseMirror_a]:underline [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-[var(--ps-text-muted)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default BulletinEditor;
