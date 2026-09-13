/**
 * A pipe between this realm and one peer.
 *
 * Built-in transports are named by a {@link TransportDescriptor} and
 * instantiated by the runtime; custom ones (WebRTC, Electron IPC, …)
 * implement this interface and are passed as an object.
 *
 * - `send(frame)` hands a JSON-serialisable frame to the wire. Should not
 *   throw; the runtime isolates a throwing send per remote regardless.
 * - `onMessage(cb)` subscribes to inbound frames once, at creation.
 *   Returns an unsubscribe function.
 * - `destroy()` releases everything. Must be idempotent. The remote client
 *   owns the transport and calls this.
 * - `duplex` — `false` for inbound-only pipes (SSE). Default `true`.
 * - `fanout` — `true` when one `send` reaches many peers (BroadcastChannel).
 *   Default `false`. A fan-out transport can never carry requests.
 * - `ready` — resolves when frames can be sent. Default: resolved. The
 *   runtime defers outbound frames until then.
 * - `onClose(cb)` — optional notification that the pipe is gone; the
 *   runtime destroys the remote client on it.
 */
/**
 * What a transport knows about an inbound frame beyond the frame itself.
 * Built-in transports that receive text (WebSocket, SSE) report `bytes`,
 * the length of the JSON text, so `maxBytes` can be checked before any
 * parsing cost matters. Transports that receive structured clones do not.
 */
export interface TransportFrameMeta {
  bytes?: number;
}

export interface Transport {
  send(frame: unknown): void;
  onMessage(callback: (frame: unknown, meta?: TransportFrameMeta) => void): () => void;
  destroy(): void;
  readonly duplex?: boolean;
  readonly fanout?: boolean;
  readonly ready?: Promise<void>;
  onClose?(callback: () => void): () => void;
}

/**
 * Descriptor for a built-in transport. A module names the kind and the
 * runtime instantiates its own implementation — the transport code never
 * ships in the module's bundle. An unknown `kind` throws
 * `TRANSPORT_UNSUPPORTED`; `hasCapability('transport.<kind>')` tells ahead.
 */
export type TransportDescriptor =
  | {
      kind: 'postmessage';
      target: Window;
      /** Inbound allow-list; frames from other origins are dropped. */
      allowedOrigins: string[];
      /** Outbound target origin for `postMessage`. Never `'*'`. */
      targetOrigin: string;
    }
  | { kind: 'message-port'; port: MessagePort }
  | { kind: 'websocket'; socket: WebSocket }
  | { kind: 'sse'; url: string; withCredentials?: boolean; eventName?: string }
  | { kind: 'broadcast-channel'; name: string };

export type TransportKind = TransportDescriptor['kind'];
