'use client';

import { useEffect, useId, useRef } from 'react';

let activeModalLockCount = 0;
let savedBodyOverflow = '';
let savedBodyTouchAction = '';
let savedHtmlOverscroll = '';

export const OVERLAY_STATE_EVENT = 'ddoodle:overlay-state-change';

interface ModalBackEntry {
  id: string;
  close: () => void;
}

const modalBackStack: ModalBackEntry[] = [];
let popstateListenerAttached = false;

function handleGlobalModalPopState() {
  const top = modalBackStack.pop();
  if (top) {
    top.close();
  }
}

function ensurePopStateListener() {
  if (popstateListenerAttached || typeof window === 'undefined') return;
  window.addEventListener('popstate', handleGlobalModalPopState);
  popstateListenerAttached = true;
}

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

/**
 * Registers an open modal/drawer on a LIFO history stack so Android hardware
 * back-button and mobile swipe-back gestures dismiss the topmost overlay
 * instead of navigating away from the current page.
 */
export function useModalBackHandler(
  isOpen: boolean,
  onClose?: () => void
): void {
  const modalId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !onCloseRef.current || typeof window === 'undefined') return;

    ensurePopStateListener();

    const entry: ModalBackEntry = {
      id: modalId,
      close: () => {
        onCloseRef.current?.();
      },
    };

    modalBackStack.push(entry);
    try {
      const currentState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};
      window.history.pushState(
        { ...currentState, __ddModalId: modalId },
        '',
        window.location.href
      );
    } catch {
      // Ignore history push errors in restricted sandbox contexts
    }

    return () => {
      const idx = modalBackStack.findIndex((item) => item.id === modalId);
      if (idx !== -1) {
        modalBackStack.splice(idx, 1);
      }
    };
  }, [isOpen, modalId]);
}

export function useModalLock(isOpen: boolean, onClose?: () => void): void {
  useModalBackHandler(isOpen, onClose);

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

