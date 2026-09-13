/** Unique client identifier in the system. */
export type ClientID = string;

/**
 * A message as handlers see it. The wire form is a different shape (see
 * the envelope spec); the runtime maps between the two.
 */
export interface Message<T extends string = string, P = any> {
  /** Unique message identifier assigned by the runtime that created it. */
  id: string;

  /** Message topic (e.g. 'user.login.v1'). */
  topic: T;

  /** Client id that emitted the message. For remote-originated messages, the id the runtime assigned per identity mode. */
  source: string;

  /** Recipient client id, or '*' for a multicast. */
  target: string;

  /** Typed payload. */
  data: P;

  /** Unix milliseconds when the message was created. */
  timestamp: number;

  /** True when delivered from the history buffer (replay), not live. */
  replayed?: boolean;

  /** True when the message was injected by a remote client (see `via`). */
  fromExternal?: boolean;

  /**
   * Id of the remote client whose transport delivered this message. Set by
   * the runtime, never by the peer; local-only, never on the wire.
   */
  via?: string;

  /**
   * The producer's frame id when the message came over a wire. Together
   * with `source` it is the cross-realm correlation key.
   */
  wireId?: string;

  /** Opaque extension block carried by the frame (`ext.traceparent`, `ext.hedwig.*`). */
  ext?: Readonly<Record<string, unknown>>;

  /** True when injected through the runtime's debug channel. */
  synthetic?: boolean;
}

/**
 * Message handler. A return value answers a `request()`; it is ignored for
 * multicasts.
 */
export type HandlerFn<T extends string, P = unknown> = (
  message: Message<T, P>,
) => void | any | Promise<void | any>;

/**
 * Options for `emit()`. Currently none: whether a message is kept for late
 * subscribers is decided by the topic's contract (`retention`), not at the
 * emit site.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MessageOptions {}

/**
 * Options for `request()`. A request is never recorded to history — a
 * replayed command would re-run with no requester to answer — so there is
 * no `history` here.
 */
export interface RequestOptions {
  /**
   * Maximum time (ms) to wait for the answer. On expiry the request resolves
   * `NACK TIMEOUT`; the handler (local or remote) may still complete on its
   * own. Falls back to the remote's default, then the runtime's, then 5000 ms
   * for remote recipients; `undefined` = wait forever for local ones.
   */
  timeout?: number;
}

/**
 * Options for replaying retained messages on subscribe. Only topics whose
 * contract declares `retention` keep anything; `state` topics keep their
 * last value.
 */
export interface ReplayOptions {
  /** Maximum number of retained messages to replay (bounded by the topic's `retention.last`). */
  limit?: number;
  /** Replay messages starting from this timestamp (Unix ms). */
  since?: number;
  /** Replay messages until this timestamp (Unix ms). */
  until?: number;
}

/** Backpressure strategies for a subscription. */
export interface BackpressureOptions {
  /** Deliver at most one message per interval (ms); later ones within the window are dropped. */
  throttle?: number;
  /** Deliver only the last message after the topic goes quiet for this long (ms). */
  debounce?: number;
  /** Sliding-window rate limit; messages over `max` per `window` ms are dropped. */
  rateLimit?: {
    max: number;
    window: number;
  };
  /** Called with the number of messages dropped by a strategy. */
  onDrop?: (droppedCount: number) => void;
}

/** Options for `on()`. All opt-in and combinable. */
export interface SubscriptionOptions {
  /** Backpressure control for incoming messages. Never applies to `request()` deliveries. */
  backpressure?: BackpressureOptions;

  /**
   * Replay the topic's retained messages when subscribing. Synchronous:
   * matching entries reach the handler before `on()` returns, oldest first,
   * flagged `replayed`. A topic without `retention` in its contract has
   * nothing to replay (the runtime logs `broker.replay.no_retention`).
   */
  replay?: ReplayOptions;

  /**
   * Exclude the subscriber's own emits from this subscription.
   * `true` (default): a client never receives a multicast it emitted itself.
   * @default true
   */
  noLocal?: boolean;

  /**
   * For `state` topics: deliver the retained (last) value to the handler
   * synchronously on subscribe, flagged `replayed: true`. Default `true`;
   * set `false` to receive live updates only. Ignored when `replay` is set —
   * the history replay then decides what the handler sees first.
   * @default true
   */
  retained?: boolean;
}
