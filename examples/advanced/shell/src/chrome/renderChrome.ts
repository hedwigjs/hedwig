import { ensureSlot } from './slots';
import { setupAiDrawer } from './aiDrawer';
import { getLang, setLang, t, type Lang } from '../../../shared/i18n/useLang';

const T = {
  en: {
    eyebrow: 'est. 2026',
    meta: 'Reference stand · Hedwig',
    metaAria: 'Reference stand for @hedwigjs 0.1.0',
    openAi: 'Open AI concierge',
    aiTitle: '-concierge',
    close: 'Close',
    langSwitch: 'Switch language',
  },
  ru: {
    eyebrow: 'осн. 2026',
    meta: 'Демо-стенд · Hedwig',
    metaAria: 'Демо-стенд для @hedwigjs 0.1.0',
    openAi: 'Открыть AI-консьерж',
    aiTitle: '-консьерж',
    close: 'Закрыть',
    langSwitch: 'Сменить язык',
  },
} as const;

function langToggleHtml(): string {
  const current = getLang();
  const items = (['en', 'ru'] as const)
    .map(
      (l) =>
        `<button class="hdw-header__lang-item${l === current ? ' is-active' : ''}" data-lang="${l}" type="button">${l.toUpperCase()}</button>`,
    )
    .join('<span class="hdw-header__lang-sep" aria-hidden="true">·</span>');
  return `<div class="hdw-header__lang" role="group" aria-label="${t(T, 'langSwitch')}">${items}</div>`;
}

const HEADER_HTML = () => `
  <header class="hdw-header">
    <div class="hdw-header__brand">
      <span class="hdw-header__wordmark">Hedwig <em>Café</em></span>
      <span class="hdw-header__eyebrow">${t(T, 'eyebrow')}</span>
    </div>
    <div class="hdw-header__actions">
      <div class="hdw-header__cart" data-slot-host="cart-header"></div>
      ${langToggleHtml()}
      <span class="hdw-header__meta" aria-label="${t(T, 'metaAria')}">
        <span class="hdw-header__meta-dot" aria-hidden="true"></span>
        <span class="hdw-header__meta-text">${t(T, 'meta')} <em>0.1.0</em></span>
      </span>
    </div>
  </header>
`;

const AI_FAB_HTML = () => `
  <button class="hdw-ai-fab" type="button" aria-label="${t(T, 'openAi')}" data-ai-fab>
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

const AI_DRAWER_HTML = () => `
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
            <em>AI</em>${t(T, 'aiTitle')}
          </h2>
        </div>
        <button class="hdw-ai-drawer__close" type="button" aria-label="${t(T, 'close')}" data-ai-close>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <div class="hdw-ai-drawer__body" data-slot-host="ai-chat"></div>
    </aside>
  </div>
`;

function wireLangToggle(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.lang as Lang | undefined;
      if (next && (next === 'en' || next === 'ru')) setLang(next);
    });
  });
}

export function renderChrome(): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');

  root.innerHTML = `
    ${HEADER_HTML()}
    <main class="hdw-main">
      <section class="hdw-main__left" data-slot-host="menu"></section>
      <aside class="hdw-main__right">
        <section class="hdw-main__cart" data-slot-host="cart-panel"></section>
        <section class="hdw-main__late-mount" data-slot-host="late-mount"></section>
        <section class="hdw-main__analytics" data-slot-host="analytics"></section>
      </aside>
    </main>
    <div class="hdw-toasts" data-slot-host="notifications" aria-live="polite"></div>
    <div class="hdw-headless" data-slot-host="checkout" aria-hidden="true"></div>
    ${AI_FAB_HTML()}
    ${AI_DRAWER_HTML()}
  `;

  ensureSlot('menu');
  ensureSlot('cart-panel');
  ensureSlot('cart-header');
  ensureSlot('late-mount');
  ensureSlot('ai-chat');
  ensureSlot('notifications');
  ensureSlot('checkout');
  ensureSlot('analytics');
  setupAiDrawer();
  wireLangToggle();
}
