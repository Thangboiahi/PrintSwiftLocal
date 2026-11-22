'use client';

import { useEffect } from 'react';

let activeModalLockCount = 0;
let savedBodyOverflow = '';
let savedBodyTouchAction = '';
let savedHtmlOverscroll = '';

export const OVERLAY_STATE_EVENT = 'ddoodle:overlay-state-change';

function emitOverlayState(count: number) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(OVERLAY_STATE_EVENT, {
      detail: { openCount: count, isOpen: count > 0 },
    })
  );
}

export function getActiveModalLockCount(): number {
  return activeModalLockCount;
}

export function useModalLock(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    if (activeModalLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      savedBodyTouchAction = document.body.style.touchAction;
      savedHtmlOverscroll = document.documentElement.style.overscrollBehavior;

      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
      document.documentElement.setAttribute('data-modal-open', 'true');
    }

    activeModalLockCount += 1;
    emitOverlayState(activeModalLockCount);

    return () => {
      activeModalLockCount = Math.max(0, activeModalLockCount - 1);
      if (activeModalLockCount === 0) {
        document.body.style.overflow = savedBodyOverflow;
        document.body.style.touchAction = savedBodyTouchAction;
        document.documentElement.style.overscrollBehavior = savedHtmlOverscroll;
        document.documentElement.removeAttribute('data-modal-open');
      }
      emitOverlayState(activeModalLockCount);
    };
  }, [isOpen]);
}

export default useModalLock;
