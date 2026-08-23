import { ensureSlot } from './slots';
import { setupAiDrawer } from './aiDrawer';

const HEADER_HTML = `
  <header class="hdw-header">
    <div class="hdw-header__brand">
      <span class="hdw-header__wordmark">Hedwig <em>Café</em></span>
      <span class="hdw-header__eyebrow">est. 2026</span>
    </div>
    <div class="hdw-header__actions">
      <div class="hdw-header__cart" data-slot-host="cart-header"></div>
      <button class="hdw-header__user" type="button">
        <span class="hdw-header__avatar">И</span>
        <span class="hdw-header__username">Иван</span>
      </button>
    </div>
  </header>
`;

const AI_FAB_HTML = `
  <button class="hdw-ai-fab" type="button" aria-label="Открыть AI-консьерж" data-ai-fab>
    <span class="hdw-ai-fab__halo" aria-hidden="true"></span>
    <span class="hdw-ai-fab__ring" aria-hidden="true"></span>
    <svg class="hdw-ai-fab__icon" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hdwAiSpark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f2c977" />
          <stop offset="55%" stop-color="#c89b4b" />
          <stop offset="100%" stop-color="#8a5a1f" />
        </linearGradient>
      </defs>
      <path
        d="M20 3
           C20 11 20.4 19.6 37 20
           C20.4 20.4 20 29 20 37
           C20 29 19.6 20.4 3 20
           C19.6 19.6 20 11 20 3 Z"
        fill="url(#hdwAiSpark)"
      />
      <path
        d="M31 6
           C31 8.6 31.1 11.4 34 11.5
           C31.1 11.6 31 14.4 31 17
           C31 14.4 30.9 11.6 28 11.5
           C30.9 11.4 31 8.6 31 6 Z"
        fill="#f2c977"
        opacity="0.9"
      />
    </svg>
  </button>
`;

const AI_DRAWER_HTML = `
  <div class="hdw-ai-drawer" data-ai-drawer aria-hidden="true">
    <div class="hdw-ai-drawer__scrim" data-ai-scrim></div>
    <aside class="hdw-ai-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="hdw-ai-title">
      <header class="hdw-ai-drawer__header">
        <div class="hdw-ai-drawer__heading">
          <span class="hdw-ai-drawer__title-icon" aria-hidden="true">
            <svg viewBox="0 0 40 40" focusable="false">
              <path
                d="M20 3 C20 11 20.4 19.6 37 20 C20.4 20.4 20 29 20 37 C20 29 19.6 20.4 3 20 C19.6 19.6 20 11 20 3 Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <h2 id="hdw-ai-title" class="hdw-ai-drawer__title">
            <em>AI</em>-консьерж
          </h2>
        </div>
        <button class="hdw-ai-drawer__close" type="button" aria-label="Закрыть" data-ai-close>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <div class="hdw-ai-drawer__body" data-slot-host="ai-chat"></div>
    </aside>
  </div>
`;

export function renderChrome(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');

  root.innerHTML = `
    ${HEADER_HTML}
    <main class="hdw-main">
      <section class="hdw-main__left" data-slot-host="storefront"></section>
      <aside class="hdw-main__right">
        <section class="hdw-main__cart" data-slot-host="cart-panel"></section>
      </aside>
    </main>
    <div class="hdw-toasts" data-slot-host="notifications" aria-live="polite"></div>
    <div class="hdw-headless" data-slot-host="checkout" aria-hidden="true"></div>
    ${AI_FAB_HTML}
    ${AI_DRAWER_HTML}
  `;

  ensureSlot('storefront');
  ensureSlot('cart-panel');
  ensureSlot('cart-header');
  ensureSlot('ai-chat');
  ensureSlot('notifications');
  ensureSlot('checkout');
  setupAiDrawer();
}
