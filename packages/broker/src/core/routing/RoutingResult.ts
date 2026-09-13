import type { ClientID } from '../types';

export const RoutingReason = {
  DELIVERED: 'DELIVERED',
  DISPATCHED: 'DISPATCHED',
  REPLAY_DELIVERED: 'REPLAY_DELIVERED',
  HOOK_REJECTED: 'HOOK_REJECTED',
  NO_SUBSCRIBERS: 'NO_SUBSCRIBERS',
  NOT_SUBSCRIBED: 'NOT_SUBSCRIBED',
  HANDLER_FAILED: 'HANDLER_FAILED',
  BROKER_DESTROYED: 'BROKER_DESTROYED',
  /** `$debug.send` called on a broker booted without `debug: true`. */
  DEBUG_DISABLED: 'DEBUG_DISABLED',
  /** `request()` — the recipient's handler did not settle within `timeout`. */
  TIMEOUT: 'TIMEOUT',
  /** `request()` to a remote client whose transport is inbound-only (SSE). */
  TRANSPORT_ONE_WAY: 'TRANSPORT_ONE_WAY',
  /** `request()` to a remote client on a fan-out transport (BroadcastChannel). */
  TRANSPORT_FANOUT: 'TRANSPORT_FANOUT',
  /** `request()` to a remote client that was destroyed or could not be reached. */
  REMOTE_GONE: 'REMOTE_GONE',
  /** A handler's return value could not be encoded for the wire. */
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
} as const;

export type RoutingReasonType = (typeof RoutingReason)[keyof typeof RoutingReason];

/**
 * RoutingResult - Message delivery result (Value Object)
 *
 * Immutable object representing the result of a message dispatch operation.
 * Can only be created through the static factory method create().
 */
export class RoutingResult<TResponse = unknown> {
  readonly status: 'ACK' | 'NACK';
  readonly reason: RoutingReasonType;
  readonly message: string;
  readonly timestamp: number;
  /** Recipient client ID — set for unicast, undefined for multicast. */
  readonly recipientId?: ClientID;
  /** All recipient client IDs — set for multicast, undefined for unicast. */
  readonly recipientIds?: ClientID[];
  readonly data?: TResponse;

  private constructor(
    status: 'ACK' | 'NACK',
    reason: RoutingReasonType,
    message: string,
    recipientId?: ClientID,
    data?: TResponse,
    recipientIds?: ClientID[],
  ) {
    this.status = status;
    this.reason = reason;
    this.message = message;
    this.timestamp = Date.now();
    this.recipientId = recipientId;
    this.recipientIds = recipientIds;
    this.data = data;

    Object.freeze(this);
  }

  /**
   * @param status - ACK for success, NACK for failure
   * @param reason - Machine-readable reason code (use RoutingReason constants)
   * @param message - Human-readable result description
   * @param recipientId - Recipient client ID (unicast only)
   * @param data - Response data from handler (Request-Reply pattern only)
   * @param recipientIds - All recipient client IDs (multicast only)
   */
  static create<T = unknown>(
    status: 'ACK' | 'NACK',
    reason: RoutingReasonType,
    message: string,
    recipientId?: ClientID,
    data?: T,
    recipientIds?: ClientID[],
  ): RoutingResult<T> {
    return new RoutingResult(status, reason, message, recipientId, data, recipientIds);
  }
}
