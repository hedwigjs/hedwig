import {
  getBroker,
  BroadcastChannelTransport,
  WebSocketTransport,
} from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

const NOTIFICATIONS_WS_URL =
  (typeof process !== 'undefined' && process.env?.NOTIFICATIONS_WS_URL) ||
  'ws://localhost:4000/ws/notifications';

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
 * Every tab hosts its own cart runtime that derives the snapshot from
 * the stream of `cart.item-*` commands. We broadcast ONLY those commands
 * (not the snapshot) — each tab replays them and arrives at the same
 * state deterministically. Sync is symmetric: any tab can be the one
 * where the user clicks; every other tab picks up the same command with
 * `fromExternal=true`, feeds its own runtime, and re-renders.
 *
 * Why not broadcast the snapshot: two tabs would race to overwrite each
 * other's state on independent actions. Command-level sync keeps each
 * runtime authoritative for its own inputs and idempotent for others.
 */
export function installCrossTabCartBridge(): () => void {
  const broker = getBroker<Topic, TopicPayloads>();
  const transport = new BroadcastChannelTransport(CROSS_TAB_CHANNEL);
  const removeBridge = broker.addBridge(CROSS_TAB_BRIDGE_ID, {
    transport,
    forward: [
      'cart.item-added.v1',
      'cart.item-incremented.v1',
      'cart.item-decremented.v1',
      'cart.item-removed.v1',
    ],
  });

  return () => {
    removeBridge();
    transport.destroy();
  };
}
