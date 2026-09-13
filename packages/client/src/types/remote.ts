import type { Transport, TransportDescriptor } from './transport';

/**
 * How a remote client maps the `source` of inbound frames to a client id.
 *
 * - `fixed` — one participant behind the wire. A frame with no `source`, or
 *   with `source === id`, is accepted as the remote; any other `source` is
 *   rejected (`SOURCE_MISMATCH`). Backends, iframes, streams.
 * - `allow` — a known set of participants behind one wire (a gateway
 *   multiplexing several services). `source` must be listed.
 * - `prefix` — a foreign realm with unknown participants (another tab, a
 *   worker running its own runtime). `source` is kept and prefixed
 *   (`tab:cart-store`) so it cannot collide with a local client.
 */
export type RemoteIdentity =
  | { mode: 'fixed' }
  | { mode: 'allow'; sources: string[] }
  | { mode: 'prefix'; prefix?: string };

export interface RemoteClientOptions {
  /** Built-in transport by descriptor, or a custom `Transport` object. */
  transport: TransportDescriptor | Transport;
  /** Default `{ mode: 'fixed' }`. */
  identity?: RemoteIdentity;
  /** Topics the remote may inject. Default: none. Glob patterns allowed. */
  accepts?: string[];
  /** Initial `forward()` patterns — the remote's subscriptions. */
  forward?: string[];
  /** Max size of a string frame (WebSocket, SSE). Larger frames are dropped. */
  maxBytes?: number;
  /** Inbound rate limit; frames over the limit are dropped. */
  rateLimit?: { max: number; window: number };
  /**
   * Default timeout (ms) for `request()` calls to this remote. Overridable
   * per call; falls back to the runtime's default, then 5000 ms.
   */
  timeout?: number;
}

/** Why an inbound frame was dropped at the remote client, before any hook. */
export type RemoteFrameRejectReason =
  | 'MALFORMED'
  | 'TOO_LARGE'
  | 'RATE_LIMITED'
  | 'TOPIC_NOT_ACCEPTED'
  | 'SOURCE_MISMATCH'
  | 'SOURCE_NOT_ALLOWED'
  | 'UNSUPPORTED'
  | 'ECHO';

/**
 * A participant whose code runs on the far side of a transport.
 *
 * Locally a proxy: deliveries to its subscriptions (`forward`) become
 * outbound frames; inbound frames become messages emitted under an identity
 * this side controls. Local clients receive those with their own `on()`.
 */
export interface RemoteClient {
  readonly id: string;
  /** Transport kind: a built-in `kind` or `'custom'`. */
  readonly kind: string;
  readonly identity: RemoteIdentity['mode'];
  readonly duplex: boolean;
  readonly fanout: boolean;
  /**
   * `duplex && !fanout` — may be the recipient of a `request()`. Otherwise
   * a request resolves `NACK TRANSPORT_ONE_WAY` / `NACK TRANSPORT_FANOUT`.
   */
  readonly requests: boolean;
  /** Resolves when the transport can carry frames; outbound waits for it. */
  readonly ready: Promise<void>;
  /** Requests in flight to this remote. */
  readonly pending: number;
  /** Unix ms when the remote was created. */
  readonly createdAt: number;
  /** Topics currently forwarded (the remote's subscriptions). */
  readonly forwardPatterns: ReadonlyArray<string>;
  /** Topics the remote may inject. */
  readonly acceptPatterns: ReadonlyArray<string>;
  /**
   * Subscribe the remote to local topics: matching multicasts are sent as
   * frames. Goes through `onSubscribe` hooks with the remote's id; throws
   * if a hook denies. Returns an unsubscribe function.
   */
  forward(pattern: string | string[]): () => void;
  /** Extend the topics the remote may inject. Returns a remover. */
  accept(pattern: string | string[]): () => void;
  /** Close the transport, unregister, fail pending requests with `REMOTE_GONE`. Idempotent. */
  destroy(): void;
}
