'use client';

export const BADGES_REFRESH_EVENT = 'dd:badges:refresh';
export const CART_COUNT_STORAGE_KEY = 'dd_cart_count';
export const LAST_SEEN_BULLETIN_KEY = 'dd_last_seen_bulletin_at';

export function emitBadgesRefresh(reason?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(BADGES_REFRESH_EVENT, {
        detail: { reason: reason || 'mutation', at: Date.now() },
      })
    );
  } catch {
    // Ignore dispatch errors in restricted contexts
  }
}

export function onBadgesRefresh(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(BADGES_REFRESH_EVENT, listener);
  return () => {
    window.removeEventListener(BADGES_REFRESH_EVENT, listener);
  };
}

export function getCartCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(CART_COUNT_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function setCartCount(count: number): void {
  if (typeof window === 'undefined') return;
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  try {
    if (safeCount === 0) {
      window.localStorage.removeItem(CART_COUNT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CART_COUNT_STORAGE_KEY, String(safeCount));
    }
  } catch {
    // Ignore localStorage quota/private mode errors
  }
  emitBadgesRefresh('cart');
}

export function getLastSeenBulletinAt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_BULLETIN_KEY);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? raw : null;
  } catch {
    return null;
  }
}

export function markBulletinsSeenNow(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_SEEN_BULLETIN_KEY, new Date().toISOString());
  } catch {
    // Ignore localStorage errors
  }
  emitBadgesRefresh('bulletin_seen');
}
