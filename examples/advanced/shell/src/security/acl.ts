/**
 * ACL rules — declarative allowlist attached to broker hooks.
 *
 * Deny by default. A client that is not listed here cannot subscribe to any
 * topic and cannot send any message. Every rule matches on the client id
 * (the string passed to `createClient(...)`).
 *
 * Two independent policies per client:
 *  - `subscribe: string[]` — topics the client is allowed to subscribe to.
 *    Use the wildcard `'*'` to allow every topic.
 *  - `send` — either `'*'` (may send any topic anywhere) or a per-recipient
 *    map. In the map, `'*'` matches multicast (recipient='*') AND acts as a
 *    fallback for unicast recipients not listed explicitly. Empty object
 *    `{}` means the client can't send anything.
 *
 * This mirrors the sender→recipient→topic-list pattern from the hse
 * project's `createAclEventsCheck`. It's intentionally static config (no
 * fetch, no permission service) — the point is to demonstrate hook wiring,
 * not to build a real IAM. Swap it for a fetched policy later.
 */

export type AclSendRule = '*' | Record<string, string[]>;

export type AclClientRule = {
  subscribe: string[];
  send: AclSendRule;
};

export type AclRules = Record<string, AclClientRule>;

export const ACL: AclRules = {
  // ── Trusted MFE — full access. ──────────────────────────────────────
  menu: {
    subscribe: ['*'],
    send: '*',
  },
  'cart-store': {
    subscribe: ['*'],
    send: '*',
  },
  'cart-ui': {
    subscribe: ['*'],
    send: '*',
  },
  checkout: {
    subscribe: ['*'],
    send: '*',
  },

  // Notifications is a display-only MFE — receives toast events, sends
  // nothing.
  'notifications-toast': {
    subscribe: ['notification.show.v1'],
    send: {},
  },

  // ai-chat is trusted for its own chat.* traffic but has no business
  // touching cart, checkout, or menu-item navigation events.
  'ai-chat': {
    subscribe: ['chat.reply-chunk.v1', 'chat.reply-completed.v1'],
    send: {
      '*': [
        'chat.message-sent.v1',
        'chat.reply-started.v1',
        'chat.reply-cancelled.v1',
      ],
    },
  },

  // ── Remote clients — participants behind a transport ────────────────
  // (`broker.createRemoteClient`). Same rules as anyone else: `subscribe`
  // covers what the shell forwards to them, `send` covers what they may
  // inject. The backend, the AI stream and the checkout iframe only send.
  'notifications-backend': {
    subscribe: [],
    send: { '*': ['notification.show.v1'] },
  },
  'ai-backend': {
    subscribe: [],
    send: {
      '*': ['chat.reply-chunk.v1', 'chat.reply-completed.v1'],
    },
  },
  'checkout-iframe': {
    subscribe: [],
    send: { '*': ['checkout.completed.v1'] },
  },

  // Other tabs over BroadcastChannel. The remote client `tabs` is
  // subscribed (`forward`) to our cart snapshots; whatever a tab sends us
  // is attributed to `tab:<its client id>` (prefix identity), so the cart
  // store of another tab needs its own send rule.
  tabs: {
    subscribe: ['cart.snapshot.v1'],
    send: {},
  },
  'tab:cart-store': {
    subscribe: [],
    send: { '*': ['cart.snapshot.v1'] },
  },

  // ── Semi-trusted — the ACL demo target. ─────────────────────────────
  // Analytics observes anonymous UI events + notification tone; nothing
  // that reveals cart contents or triggers business flow. Cannot send.
  analytics: {
    subscribe: [
      'ui.menu-item-opened.v1',
      'ui.menu-item-closed.v1',
      'notification.show.v1',
    ],
    send: {},
  },

  // ── Replay-buffer demo — reads the last cart snapshot on mount. ─────
  // Only listens; never emits. Separate id so the demo's subscription
  // appears distinctly in DevTools' Clients tab.
  'late-mount-demo': {
    subscribe: ['cart.snapshot.v1'],
    send: {},
  },
};

// ────────────────────────────────────────────────────────────────────
// Match helpers
// ────────────────────────────────────────────────────────────────────

export function isSubscribeAllowed(
  rules: AclRules,
  clientId: string,
  topic: string,
): boolean {
  const rule = rules[clientId];
  if (!rule) return false;
  return rule.subscribe.includes('*') || rule.subscribe.includes(topic);
}

export function isSendAllowed(
  rules: AclRules,
  sender: string,
  target: string,
  topic: string,
): boolean {
  const rule = rules[sender];
  if (!rule) return false;
  if (rule.send === '*') return true;

  // Explicit per-recipient list takes precedence; `'*'` acts as a fallback
  // for unicast targets not listed explicitly, AND matches multicast
  // (target === '*') by design.
  const listForTarget = rule.send[target] ?? rule.send['*'];
  return Array.isArray(listForTarget) && listForTarget.includes(topic);
}
