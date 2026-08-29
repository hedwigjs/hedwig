import {
  getBroker,
  BroadcastChannelTransport,
  WebSocketTransport,
} from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

// Baked at build time by webpack's EnvironmentPlugin (see webpack.config.js).
// Falls back to the dev-server localhost URL when the env is absent.
const NOTIFICATIONS_WS_URL = process.env.NOTIFICATIONS_WS_URL as string;

const BRIDGE_ID = 'backend-notifications';
const CROSS_TAB_BRIDGE_ID = 'cross-tab-cart';
const CROSS_TAB_CHANNEL = 'hedwig-cart-sync';
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * Connect the backend notifications WebSocket to the local broker via a
 * WebSocketTransport bridge.
 *
 * Design note: the socket lives in the shell (the "host adapter" layer),
 * not inside the notifications MFE. Consumer MFEs stay pure — they just
 * subscribe to `notification.show.v1` and don't care whether the message
 * was pushed by the server or emitted by another MFE (e.g. checkout).
 *
 * The transport wraps a single WebSocket instance; connection management
 * (open, close, exponential backoff) stays external. On each successful
 * reconnect we tear down the previous bridge and register a fresh one.
 */
export function installBackendNotificationsBridge(): void {
  const broker = getBroker<Topic, TopicPayloads>();

  let socket: WebSocket | null = null;
  let removeBridge: (() => void) | null = null;
  let retryDelay = 1000;
  let retryTimer: number | null = null;

  function connect(): void {
    try {
      socket = new WebSocket(NOTIFICATIONS_WS_URL);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[shell:bridges] socket construct failed', err);
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      retryDelay = 1000;
      removeBridge?.();
      removeBridge = broker.addBridge(BRIDGE_ID, {
        transport: new WebSocketTransport(socket!),
        forward: ['notification.show.v1'],
      });
    });

    socket.addEventListener('close', () => {
      removeBridge?.();
      removeBridge = null;
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
 * Cross-tab cart sync via BroadcastChannel.
 *
 * With the CQRS refactor, mutations are addressed **requests** to a specific
 * cart-runtime instance and cannot be broadcast — a request needs its
 * recipient to be locally subscribed on the receiving broker to get a
 * response. Instead we broadcast the **state** — `cart.snapshot.v1` — which
 * is exactly the retained payload late/other-tab subscribers already know
 * how to render. Each tab's cart-runtime is the source of truth for its own
 * mutations; when its snapshot lands in another tab via this bridge, the
 * remote tab's UI re-renders from that snapshot without touching its local
 * runtime.
 *
 * Note: this converges to "last write wins" if two tabs mutate at the same
 * time. For richer conflict handling later — CRDT snapshots, vector clocks,
 * or an explicit owner-tab election.
 */
export function installCrossTabCartBridge(): () => void {
  const broker = getBroker<Topic, TopicPayloads>();
  const transport = new BroadcastChannelTransport(CROSS_TAB_CHANNEL);
  const removeBridge = broker.addBridge(CROSS_TAB_BRIDGE_ID, {
    transport,
    forward: ['cart.snapshot.v1'],
  });

  return () => {
    removeBridge();
    transport.destroy();
  };
}
