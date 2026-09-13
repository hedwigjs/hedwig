import type { Transport } from '../core/transport/Transport.types';

/**
 * Configuration for {@link SSETransport}.
 */
export interface SSETransportConfig {
  /**
   * URL of the Server-Sent Events endpoint. `EventSource` is created
   * internally and the browser handles reconnection.
   */
  url: string;

  /**
   * If set, subscribes to a named SSE event (`event: <name>`) instead of
   * the default unnamed `message` stream. Broker Messages already carry
   * their own `topic` field, so most integrations leave this unset and
   * multiplex on the topic.
   */
  eventName?: string;

  /**
   * Passed to `new EventSource(url, { withCredentials })`. Enables sending
   * cookies for same-origin auth on cross-origin SSE endpoints.
   */
  withCredentials?: boolean;
}

/**
 * SSETransport — inbound-only transport backed by `EventSource`.
 *
 * SSE is server → client by design. `send()` is a no-op with a warning;
 * a remote client on this transport is inbound-only (`duplex: false`).
 * If your integration needs client → server frames, use
 * {@link WebSocketTransport} or pair SSE with a separate POST endpoint.
 *
 * Reconnect handling is delegated to the browser's built-in EventSource
 * behavior — no external backoff required, unlike WebSocket where the
 * transport wraps an already-connected socket.
 *
 * Expects incoming payloads to be JSON-encoded broker Messages
 * (`{id, topic, source, target, data, timestamp}`) — the same wire
 * format every transport uses.
 */
export class SSETransport implements Transport {
  /** Server → client only. A remote on this transport can never be asked. */
  readonly duplex = false;
  readonly fanout = false;
  #eventSource: EventSource;
  #eventName: string;
  #messageHandler: ((e: MessageEvent) => void) | null = null;
  #messageCallback: ((data: unknown, meta?: { bytes?: number }) => void) | null = null;

  constructor(config: SSETransportConfig) {
    this.#eventName = config.eventName ?? 'message';
    this.#eventSource = new EventSource(config.url, {
      withCredentials: config.withCredentials ?? false,
    });
  }

  /**
   * SSE has no upstream channel from the browser. This method exists to
   * satisfy the {@link Transport} contract but never actually
   * transmits — it logs a warning so misconfigurations surface early.
   *
   * Practical guidance: do not `forward()` anything to a remote client on
   * SSE — the runtime marks it `duplex: false` — so this warning never
   * fires in normal operation.
   */
  send(_data: unknown): void {
    console.warn(
      '[SSETransport] send() is a no-op — SSE is inbound-only. ' +
        'Do not forward() topics to a remote client on SSE; use a ' +
        'websocket transport for duplex traffic.',
    );
  }

  /**
   * Subscribe to incoming SSE messages. Parses JSON payloads before
   * handing them to the remote client.
   */
  onMessage(callback: (data: unknown, meta?: { bytes?: number }) => void): () => void {
    this.#messageCallback = callback;

    this.#messageHandler = (e: MessageEvent) => {
      try {
        if (typeof e.data === 'string') {
          this.#messageCallback?.(JSON.parse(e.data), { bytes: e.data.length });
        } else {
          this.#messageCallback?.(e.data);
        }
      } catch (error) {
        console.error('[SSETransport] Failed to parse message:', error);
      }
    };

    this.#eventSource.addEventListener(this.#eventName, this.#messageHandler);

    return () => this.destroy();
  }

  /**
   * Cleanup: remove listener and close the underlying EventSource.
   */
  destroy(): void {
    if (this.#messageHandler) {
      this.#eventSource.removeEventListener(this.#eventName, this.#messageHandler);
      this.#messageHandler = null;
    }
    this.#messageCallback = null;
    this.#eventSource.close();
  }
}
