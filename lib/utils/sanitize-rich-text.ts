/**
 * Strict allowlist HTML sanitizer for DD oodle Rich Text content.
 * Permits ONLY semantic formatting tags:
 *   <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>, <h4>
 * Strips all attributes, inline styles, event handlers, scripts, and unsupported tags.
 */

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h4']);

const TAG_ALIASES: Record<string, string> = {
  b: 'strong',
  i: 'em',
  h1: 'h4',
  h2: 'h4',
  h3: 'h4',
  h5: 'h4',
  h6: 'h4',
  div: 'p',
};

/**
 * Escapes raw HTML entities for plain-text conversion.
 */
export function escapeHtmlEntities(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes rich text HTML down to a strict allowlist of attribute-free semantic tags:
 * `<p>`, `<br>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<h4>`.
 */
export function sanitizeRichTextHtml(input: string | null | undefined): string {
  if (!input || typeof input !== 'string') return '';

  // 1. Remove script/style/iframe/object/embed/svg blocks completely
  let cleaned = input
    .replace(/<(script|style|iframe|object|embed|svg|math|form|input|button|textarea)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|form|input|button|textarea)[^>]*\/?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // 2. If the string contains no HTML tags at all, convert plain text line breaks into <p>/<br>
  if (!/<[a-z][\s\S]*>/i.test(cleaned)) {
    const trimmed = cleaned.trim();
    if (!trimmed) return '';
    return trimmed
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtmlEntities(para.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  // 3. Replace all tags with either canonical attribute-free allowed tags or strip them
  cleaned = cleaned.replace(/<\/?([a-zA-Z0-9-]+)(?:\s[^>]*)?\/?>/g, (fullMatch, rawTag: string) => {
    const isClosing = fullMatch.startsWith('</');
    const lower = rawTag.toLowerCase();
    const mapped = TAG_ALIASES[lower] || lower;

    if (!ALLOWED_TAGS.has(mapped)) {
      return '';
    }

    if (mapped === 'br') {
      return isClosing ? '' : '<br>';
    }

    return isClosing ? `</${mapped}>` : `<${mapped}>`;
  });

  // 4. Clean up empty consecutive paragraphs
  cleaned = cleaned
    .replace(/<p>\s*(?:<br>\s*)*<\/p>/gi, '')
    .trim();

  return cleaned;
}

/**
 * Extracts plain text from rich text HTML for character/word counting and search indexing.
 */
export function stripRichTextToPlain(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h4|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
