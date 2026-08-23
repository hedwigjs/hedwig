import { getBroker, WebSocketTransport } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

const NOTIFICATIONS_WS_URL =
  (typeof process !== 'undefined' && process.env?.NOTIFICATIONS_WS_URL) ||
  'ws://localhost:4000/ws/notifications';

const BRIDGE_ID = 'backend-notifications';
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
