import type { ClientID } from './message';

/**
 * Machine-readable outcome of a delivery. Closed set: module code may
 * switch on it exhaustively.
 */
export const RoutingReason = {
  /** Unicast: the recipient's handler ran and returned. */
  DELIVERED: 'DELIVERED',
  /** Multicast: handed to every current subscriber. */
  DISPATCHED: 'DISPATCHED',
  /** Delivered from the history buffer during `on()`. */
  REPLAY_DELIVERED: 'REPLAY_DELIVERED',
  /** A `beforeSend` hook denied the message. */
  HOOK_REJECTED: 'HOOK_REJECTED',
  /** Multicast with nobody subscribed. */
  NO_SUBSCRIBERS: 'NO_SUBSCRIBERS',
  /** Unicast: the recipient has no handler for the topic. */
  NOT_SUBSCRIBED: 'NOT_SUBSCRIBED',
  /** The handler threw. */
  HANDLER_FAILED: 'HANDLER_FAILED',
  /** The runtime was shut down. */
  BROKER_DESTROYED: 'BROKER_DESTROYED',
  /** The debug channel is off (`initBroker({ debug: true })` not set). */
  DEBUG_DISABLED: 'DEBUG_DISABLED',
  /** `request()`: no answer within `timeout`. The handler may still run. */
  TIMEOUT: 'TIMEOUT',
  /** `request()` to a remote client whose transport is inbound-only (SSE). */
  TRANSPORT_ONE_WAY: 'TRANSPORT_ONE_WAY',
  /** `request()` to a remote client on a fan-out transport (BroadcastChannel). */
  TRANSPORT_FANOUT: 'TRANSPORT_FANOUT',
  /** `request()` to a remote client that was destroyed or could not be reached. */
  REMOTE_GONE: 'REMOTE_GONE',
  /** A handler's return value could not be encoded for the wire. */
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  /** SDK only: queued before the runtime existed and dropped from a full buffer. */
  RUNTIME_NOT_READY: 'RUNTIME_NOT_READY',
  /**
   * SDK only: the runtime in this realm is older than this SDK requires
   * (`MIN_RUNTIME`). The client never binds; every call answers this.
   */
  RUNTIME_TOO_OLD: 'RUNTIME_TOO_OLD',
} as const;

export type RoutingReasonType = (typeof RoutingReason)[keyof typeof RoutingReason];

/**
 * Result of `emit()` / `request()`. Immutable; the runtime creates it.
 */
export interface RoutingResult<TResponse = unknown> {
  readonly status: 'ACK' | 'NACK';
  readonly reason: RoutingReasonType;
  /** Human-readable summary. */
  readonly message: string;
  /** Unix ms when the result was produced. */
  readonly timestamp: number;
  /** Recipient client id — unicast only. */
  readonly recipientId?: ClientID;
  /** All recipient client ids — multicast only. */
  readonly recipientIds?: ClientID[];
  /** The handler's return value — `request()` only. */
  readonly data?: TResponse;
}
