/**
 * Pure, XSS-safe SVG markup sanitizer for Super-Admin custom brand logos.
 *
 * Security guarantees:
 * 1. Enforces a single root `<svg ...>...</svg>` document within a 64 KB ceiling.
 * 2. Strips dangerous elements (`<script>`, `<iframe>`, `<object>`, `<embed>`,
 *    `<foreignObject>`, `<link>`, `<meta>`, `<base>`, `<style>` with unsafe rules,
 *    `<animate>`, `<set>`, `<handler>`, `<use>` with external references).
 * 3. Strips all `on*` event handler attributes (e.g. `onload`, `onclick`, `onerror`).
 * 4. Strips `javascript:`, `vbscript:`, and `data:text/html` URLs in attributes or styles.
 * 5. Ensures responsive sizing (`width="100%"`, `height="100%"`, and `viewBox` fallback).
 */

const MAX_SVG_BYTES = 64 * 1024;

const FORBIDDEN_PAIRED_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'foreignobject',
  'link',
  'meta',
  'base',
  'audio',
  'video',
  'canvas',
  'form',
  'input',
  'textarea',
  'button',
  'select',
  'handler',
  'listener',
  'applet',
];

const FORBIDDEN_SELF_CLOSING_TAGS = [
  ...FORBIDDEN_PAIRED_TAGS,
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
];

function stripDangerousCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:[^;"]*;?/gi, '')
    .replace(/-moz-binding\s*:[^;"]*;?/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?:javascript|vbscript|data\s*:\s*text\/html|https?:|\/\/)[^)]*\)/gi, 'none');
}

function isSafeSvgHref(value: string): boolean {
  const normalized = value
    .replace(/[\u0000-\u0020]+/g, '')
    .toLowerCase();
  // Only allow local fragment references (#grad1, #clip1) inside SVG
  return normalized.startsWith('#') && normalized.length > 1;
}

function extractNumericDimension(attrs: string, name: 'width' | 'height'): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeTagAttributes(tagName: string, rawAttrs: string): string {
  const lowerTag = tagName.toLowerCase();
  const attrRegex =
    /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const cleaned: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const attrName = match[1];
    const lowerName = attrName.toLowerCase();
    const attrVal = match[2] ?? match[3] ?? match[4] ?? '';

    // Block all inline event handlers (onload, onclick, onmouseover, etc.)
    if (lowerName.startsWith('on')) continue;

    // Block raw srcdoc/formaction/action/data attributes that can execute payloads
    if (
      lowerName === 'src' ||
      lowerName === 'srcdoc' ||
      lowerName === 'formaction' ||
      lowerName === 'action' ||
      lowerName === 'xmlns:ev'
    ) {
      continue;
    }

    // Check href / xlink:href (only local #fragment IDs allowed)
    if (lowerName === 'href' || lowerName === 'xlink:href') {
      if (!isSafeSvgHref(attrVal)) continue;
      cleaned.push(`${attrName}="${attrVal.replace(/"/g, '&quot;')}"`);
      continue;
    }

    // Sanitize inline style attributes
    if (lowerName === 'style') {
      const safeStyle = stripDangerousCss(attrVal).trim();
      if (!safeStyle) continue;
      cleaned.push(`style="${safeStyle.replace(/"/g, '&quot;')}"`);
      continue;
    }

    // Block any attribute value containing javascript:/vbscript:/data:text/html
    const compactVal = attrVal.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
    if (
      compactVal.includes('javascript:') ||
      compactVal.includes('vbscript:') ||
      compactVal.includes('data:text/html') ||
      compactVal.includes('expression(')
    ) {
      continue;
    }

    // On root <svg>, we normalize width/height later for crisp responsive scaling
    if (lowerTag === 'svg' && (lowerName === 'width' || lowerName === 'height')) {
      continue;
    }

    const escaped = attrVal.replace(/"/g, '&quot;');
    cleaned.push(`${attrName}="${escaped}"`);
  }

  return cleaned.join(' ');
}

export function extractSvgValidationError(raw: string): string | null {
  if (!raw || typeof raw !== 'string') {
    return 'Paste SVG code or upload a .svg file.';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'SVG markup is empty.';
  }
  if (trimmed.length > MAX_SVG_BYTES) {
    return `SVG exceeds the maximum size limit (${Math.round(MAX_SVG_BYTES / 1024)} KB).`;
  }
  if (!/<svg\b[\s\S]*<\/svg>/i.test(trimmed)) {
    return 'Markup must contain a valid <svg>...</svg> root element.';
  }
  const sanitized = sanitizeSvgMarkup(trimmed);
  if (!sanitized) {
    return 'SVG could not be safely sanitized. Remove scripts or invalid markup.';
  }
  return null;
}

export function sanitizeSvgMarkup(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let markup = raw.trim();
  if (!markup || markup.length > MAX_SVG_BYTES) return null;

  // Strip XML declarations, DOCTYPEs, CDATA wrappers, and HTML comments
  markup = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')
    .trim();

  // Extract strictly the first <svg ...>...</svg> block
  const svgMatch = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(markup);
  if (!svgMatch) return null;

  const rootRawAttrs = svgMatch[1] || '';
  let inner = svgMatch[2] || '';

  // Remove any nested <svg> or forbidden paired elements completely
  for (const tag of FORBIDDEN_PAIRED_TAGS) {
    const pairedRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    inner = inner.replace(pairedRe, '');
  }

  // Remove forbidden self-closing / unclosed tags
  for (const tag of FORBIDDEN_SELF_CLOSING_TAGS) {
    const selfRe = new RegExp(`<\\/?${tag}\\b[^>]*\\/?>`, 'gi');
    inner = inner.replace(selfRe, '');
  }

  // Sanitize inline <style> blocks inside SVG
  inner = inner.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, _a, cssBody: string) => {
    const safeCss = stripDangerousCss(cssBody).trim();
    return safeCss ? `<style>${safeCss}</style>` : '';
  });

  // Sanitize all remaining element tags & attributes inside <svg>
  inner = inner.replace(
    /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g,
    (_full, closingSlash: string, tagName: string, attrs: string, selfClose: string) => {
      const lowerTag = tagName.toLowerCase();
      if (
        FORBIDDEN_SELF_CLOSING_TAGS.includes(lowerTag) ||
        lowerTag === 'svg'
      ) {
        return '';
      }
      if (closingSlash) {
        return `</${tagName}>`;
      }
      const cleanAttrs = sanitizeTagAttributes(tagName, attrs || '');
      const attrPart = cleanAttrs ? ` ${cleanAttrs}` : '';
      return `<${tagName}${attrPart}${selfClose ? ' /' : ''}>`;
    }
  );

  // Clean root <svg> attributes and enforce responsive sizing + viewBox
  const origW = extractNumericDimension(rootRawAttrs, 'width');
  const origH = extractNumericDimension(rootRawAttrs, 'height');
  const hasViewBox = /\bviewBox\s*=/i.test(rootRawAttrs);
  const hasXmlns = /\bxmlns\s*=/i.test(rootRawAttrs);

  const cleanRootAttrs = sanitizeTagAttributes('svg', rootRawAttrs);
  const rootParts: string[] = [];

  if (!hasXmlns) {
    rootParts.push('xmlns="http://www.w3.org/2000/svg"');
  }
  if (cleanRootAttrs) {
    rootParts.push(cleanRootAttrs);
  }
  if (!hasViewBox) {
    const vbW = origW ?? 64;
    const vbH = origH ?? 64;
    rootParts.push(`viewBox="0 0 ${vbW} ${vbH}"`);
  }
  rootParts.push('width="100%"');
  rootParts.push('height="100%"');
  if (!/\bpreserveAspectRatio\s*=/i.test(rootRawAttrs)) {
    rootParts.push('preserveAspectRatio="xMidYMid meet"');
  }

  const finalSvg = `<svg ${rootParts.join(' ')}>${inner.trim()}</svg>`;

  // Final defense-in-depth sanity check
  const lowered = finalSvg.toLowerCase();
  if (
    lowered.includes('<script') ||
    lowered.includes('javascript:') ||
    lowered.includes('vbscript:') ||
    lowered.includes('<foreignobject') ||
    /\son[a-z]+\s*=/i.test(finalSvg)
  ) {
    return null;
  }

  return finalSvg;
}
