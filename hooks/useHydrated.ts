import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * React 19 / Next.js 15 SSR-safe hydration hook.
 * Returns `false` during SSR and the initial client hydration render,
 * then `true` immediately after hydration without triggering cascading
 * `useEffect` setState renders.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
