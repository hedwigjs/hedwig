import type { BridgeTransport } from '../core/bridge/Bridge.types';

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
 * bridges built on top of this transport are effectively receive-only.
 * If your integration needs client → server frames, use
 * {@link WebSocketTransport} or pair SSE with a separate POST endpoint.
 *
 * Reconnect handling is delegated to the browser's built-in EventSource
 * behavior — no external backoff required, unlike WebSocket where the
 * transport wraps an already-connected socket.
 *
 * Expects incoming payloads to be JSON-encoded broker Messages
 * (`{id, topic, source, target, data, timestamp}`) — the same wire
 * format all the other bridges use.
 */
export class SSETransport implements BridgeTransport {
  #eventSource: EventSource;
  #eventName: string;
  #messageHandler: ((e: MessageEvent) => void) | null = null;
  #messageCallback: ((data: unknown) => void) | null = null;

  constructor(config: SSETransportConfig) {
    this.#eventName = config.eventName ?? 'message';
    this.#eventSource = new EventSource(config.url, {
      withCredentials: config.withCredentials ?? false,
    });
  }

  /**
   * SSE has no upstream channel from the browser. This method exists to
   * satisfy the {@link BridgeTransport} contract but never actually
   * transmits — it logs a warning so misconfigurations surface early.
   *
   * Practical guidance: keep the bridge's `forward` list to topics that
   * are ONLY emitted by the server (never by local clients), so this
   * warning never fires in normal operation.
   */
  send(_data: unknown): void {
    console.warn(
      '[SSETransport] send() is a no-op — SSE is inbound-only. ' +
        'Ensure the bridge forward list contains topics emitted only by ' +
        'the server, or use WebSocketTransport for duplex traffic.',
    );
  }

  /**
   * Subscribe to incoming SSE messages. Parses JSON payloads before
   * forwarding to the bridge.
   */
  onMessage(callback: (data: unknown) => void): () => void {
    this.#messageCallback = callback;

    this.#messageHandler = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        this.#messageCallback?.(data);
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
