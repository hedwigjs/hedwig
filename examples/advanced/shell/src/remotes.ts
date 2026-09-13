import { getBroker } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { getLang } from '../../shared/i18n/useLang';

// Baked at build time by webpack's EnvironmentPlugin (see webpack.config.js).
// Falls back to the dev-server localhost URL when the env is absent. The
// language query is appended at runtime so backend can localize the toast
// content for the connecting client.
const NOTIFICATIONS_WS_URL_BASE = process.env.NOTIFICATIONS_WS_URL as string;
const NOTIFICATIONS_WS_URL = `${NOTIFICATIONS_WS_URL_BASE}?lang=${getLang()}`;

const NOTIFICATIONS_REMOTE_ID = 'notifications-backend';
const TABS_REMOTE_ID = 'tabs';
const CROSS_TAB_CHANNEL = 'hedwig-cart-sync';
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * The notifications backend as a remote client over WebSocket.
 *
 * Design note: the socket lives in the shell (the "host adapter" layer),
 * not inside the notifications MFE. Consumer MFEs stay pure — they just
 * subscribe to `notification.show.v1` and don't care whether the message
 * was pushed by the server or emitted by another MFE (e.g. checkout).
 *
 * The remote is registered as soon as the socket is constructed: outbound
 * frames wait for the transport's `ready` (socket OPEN), and when the
 * socket closes the runtime tears the remote down itself, which frees the
 * id for the next attempt. Reconnect (exponential backoff) stays here.
 *
 * Identity is `fixed` (the default): every frame on this socket is the
 * backend, a frame claiming another `source` is dropped at the edge as
 * `remote.frame.rejected SOURCE_MISMATCH`. `accepts` names the only topic
 * the backend may inject; ACL rules for `notifications-backend` in
 * `security/acl.ts` still apply on top.
 */
export function installBackendNotificationsRemote(): void {
  const broker = getBroker<Topic, TopicPayloads>();

  let retryDelay = 1000;
  let retryTimer: number | null = null;

  function connect(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(NOTIFICATIONS_WS_URL);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[shell:remotes] socket construct failed', err);
      scheduleReconnect();
      return;
    }

    broker.createRemoteClient(NOTIFICATIONS_REMOTE_ID, {
      transport: { kind: 'websocket', socket },
      accepts: ['notification.show.v1'],
    });

    socket.addEventListener('open', () => {
      retryDelay = 1000;
    });

    // The runtime has already destroyed the remote by the time our
    // listener runs (its own `close` listener was registered first).
    socket.addEventListener('close', () => {
      scheduleReconnect();
    });

    // `error` всегда сопровождается `close` — реконнектимся оттуда.
    socket.addEventListener('error', () => {});
  }

  function scheduleReconnect(): void {
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RECONNECT_DELAY_MS);
    retryTimer = window.setTimeout(connect, delay);
  }

  connect();

  // No teardown API for now — shell lives for the whole session.
  void retryTimer;
}

/**
 * Other tabs as one remote client over BroadcastChannel.
 *
 * With the CQRS refactor, mutations are addressed **requests** to a specific
 * cart-store instance and cannot be broadcast — a request needs its
 * recipient to be locally subscribed on the receiving broker to get a
 * response. Instead we replicate the **state** — `cart.snapshot.v1` — which
 * is exactly the retained payload late/other-tab subscribers already know
 * how to render. Each tab's cart-store is the source of truth for its own
 * mutations; when its snapshot lands in another tab, that tab's UI
 * re-renders from the snapshot without touching its local runtime.
 *
 * `forward` is the remote's subscription (what we send to the other tabs),
 * `accepts` is what they may send us. Every other tab runs its own broker
 * with its own `cart-store`, so identity is `prefix`: their snapshot
 * arrives as `tab:cart-store`, which can never collide with ours. The ACL
 * has a rule for that id.
 *
 * Each tab keeps its own cart store; the stores converge on `updatedAt`
 * in the snapshot (see mfe/cart/src/state/cartStore.ts): a newer snapshot
 * is adopted silently, an older one is answered with the current cart, an
 * equal one is ignored — one mutation is one frame per other tab, no echo.
 * Two tabs mutating at the same time end up with "last write
 * wins". For richer conflict handling later — CRDT snapshots, vector
 * clocks, or an explicit owner-tab election.
 */
export function installCrossTabCartRemote(): () => void {
  const broker = getBroker<Topic, TopicPayloads>();
  const tabs = broker.createRemoteClient(TABS_REMOTE_ID, {
    transport: { kind: 'broadcast-channel', name: CROSS_TAB_CHANNEL },
    identity: { mode: 'prefix', prefix: 'tab' },
    accepts: ['cart.snapshot.v1'],
    forward: ['cart.snapshot.v1'],
  });

  return () => tabs.destroy();
}
