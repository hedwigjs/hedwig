/**
 * AI drawer chrome — FAB + slide-out panel.
 *
 * The panel is a passive container; the actual chat UI is a separate MFE
 * that mounts into the `[data-slot-host="ai-chat"]` inside it. The MFE
 * stays mounted after first open so chat history survives close/reopen —
 * we only toggle the drawer's `aria-hidden` attribute and CSS transform.
 */

const OPEN_CLASS = 'is-open';

let isOpen = false;
let fab: HTMLButtonElement | null = null;
let drawer: HTMLElement | null = null;

function setState(next: boolean): void {
  isOpen = next;
  if (!drawer || !fab) return;

  drawer.classList.toggle(OPEN_CLASS, isOpen);
  drawer.setAttribute('aria-hidden', String(!isOpen));
  fab.setAttribute('aria-expanded', String(isOpen));

  if (isOpen) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

export function setupAiDrawer(): void {
  fab = document.querySelector<HTMLButtonElement>('[data-ai-fab]');
  drawer = document.querySelector<HTMLElement>('[data-ai-drawer]');
  const scrim = document.querySelector<HTMLElement>('[data-ai-scrim]');
  const close = document.querySelector<HTMLButtonElement>('[data-ai-close]');

  if (!fab || !drawer || !scrim || !close) {
    throw new Error('AI drawer chrome missing required elements');
  }

  fab.setAttribute('aria-expanded', 'false');

  fab.addEventListener('click', () => setState(!isOpen));
  scrim.addEventListener('click', () => setState(false));
  close.addEventListener('click', () => setState(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) setState(false);
  });
}
