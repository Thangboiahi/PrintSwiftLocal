/**
 * Unified Native Share Engine (Pass V6-A)
 *
 * Uses the native Web Share API (`navigator.share`) when available—silently
 * handling user cancellations (`AbortError`)—and falls back seamlessly to the
 * themed `<ShareSheetModal />` mounted inside `AppShell.tsx`.
 */

export interface SharePayload {
  title: string;
  text?: string;
  url?: string;
  whatsappMessage?: string;
}

export interface ResolvedSharePayload {
  title: string;
  text: string;
  url: string;
  whatsappMessage: string;
}

export type ShareOutcome = 'native' | 'cancelled' | 'fallback' | 'unsupported';

export const SHARE_SHEET_OPEN_EVENT = 'ddoodle:open-share-sheet';

/**
 * Validates and resolves a share URL to a safe `http:` or `https:` string.
 * Rejects unsafe schemes such as `javascript:` or `data:`.
 */
export function resolveSafeShareUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (trimmed) {
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed;
    }
    if (trimmed.startsWith('/') && typeof window !== 'undefined') {
      return `${window.location.origin}${trimmed}`;
    }
  }
  if (typeof window !== 'undefined' && window.location?.href) {
    const href = window.location.href;
    if (href.startsWith('https://') || href.startsWith('http://')) {
      return href;
    }
  }
  return '';
}

export function normalizeSharePayload(payload: SharePayload): ResolvedSharePayload {
  const title = String(payload.title || 'DD oodle').trim() || 'DD oodle';
  const text = String(payload.text || '').trim();
  const url = resolveSafeShareUrl(payload.url);
  const defaultWa = [title, text, url].filter(Boolean).join('\n');
  const whatsappMessage = String(payload.whatsappMessage || '').trim() || defaultWa;
  return {
    title,
    text,
    url,
    whatsappMessage,
  };
}

export function canUseNativeShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  );
}

/**
 * Shares content via native `navigator.share()` first.
 * - Silently resolves `{ ok: true, method: 'cancelled' }` on `AbortError` so
 *   cancelling the OS share sheet never triggers an error toast.
 * - On desktop or unsupported browsers, opens the themed `<ShareSheetModal />`
 *   via `onFallback` or the global `SHARE_SHEET_OPEN_EVENT` bus.
 */
export async function shareContent(
  payload: SharePayload,
  options?: {
    forceFallback?: boolean;
    onFallback?: (resolved: ResolvedSharePayload) => void;
  }
): Promise<{ ok: boolean; method: ShareOutcome }> {
  const resolved = normalizeSharePayload(payload);

  if (!options?.forceFallback && canUseNativeShare()) {
    try {
      const shareData: ShareData = {
        title: resolved.title,
      };
      if (resolved.text) shareData.text = resolved.text;
      if (resolved.url) shareData.url = resolved.url;

      await navigator.share(shareData);
      return { ok: true, method: 'native' };
    } catch (err) {
      // User dismissed native share sheet — treat as clean silent cancellation
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || /abort|cancel/i.test(err.message || ''))
      ) {
        return { ok: true, method: 'cancelled' };
      }
      // Fall through to themed ShareSheetModal for NotAllowedError / desktop quirks
    }
  }

  if (options?.onFallback) {
    options.onFallback(resolved);
    return { ok: true, method: 'fallback' };
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ResolvedSharePayload>(SHARE_SHEET_OPEN_EVENT, {
        detail: resolved,
      })
    );
    return { ok: true, method: 'fallback' };
  }

  return { ok: false, method: 'unsupported' };
}
