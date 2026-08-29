/**
 * Shared body-scroll lock helper.
 *
 * Multiple modals in the stand (CartPopup → CheckoutModal → MenuItemModal)
 * independently used to toggle `document.body.style.overflow`. Two issues
 * with the naïve approach:
 *
 *  1. Nesting: modal A captures `overflow=''`, sets `hidden`; modal B
 *     captures `overflow='hidden'`, sets `hidden`; A unmounts, restores
 *     `''`; B unmounts, restores `hidden` — body stays locked.
 *
 *  2. Mobile: iOS Safari doesn't respect `overflow: hidden` on body for
 *     touch scrolling. You need `position: fixed` + explicit `top` offset
 *     to freeze scroll, then restore both plus the scroll position on
 *     unlock.
 *
 * Fix: a module-level reference counter across MFEs, plus the
 * fixed-position pattern that actually works on mobile.
 *
 * Note about MF module duplication: each MFE bundles its own copy of
 * this file, so `lockCount` is per-MFE. Since browsers only ever run one
 * event loop / one document.body, we anchor the state on the DOM itself
 * via `document.body.dataset.scrollLockCount` — read/updated atomically
 * inside the same tick. That way lock/unlock from different MFEs still
 * cooperate on the same counter.
 */

const COUNT_KEY = 'scrollLockCount';
const TOP_KEY = 'scrollLockTop';

function readCount(): number {
  const raw = document.body.dataset[COUNT_KEY];
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function writeCount(n: number): void {
  if (n <= 0) {
    delete document.body.dataset[COUNT_KEY];
  } else {
    document.body.dataset[COUNT_KEY] = String(n);
  }
}

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  const next = readCount() + 1;
  if (next === 1) {
    const scrollY = window.scrollY;
    document.body.dataset[TOP_KEY] = String(scrollY);
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  writeCount(next);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, readCount() - 1);
    writeCount(remaining);
    if (remaining === 0) {
      const restored = parseInt(document.body.dataset[TOP_KEY] ?? '0', 10) || 0;
      delete document.body.dataset[TOP_KEY];
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, restored);
    }
  };
}
