import type { ClientID } from '../types';
import type { RoutingReasonType, RoutingResult as RoutingResultShape } from '@hedwigjs/client';
import { RoutingReason } from '@hedwigjs/client';

// The closed set of reasons and the result shape are owned by the SDK so
// module code can switch on them without depending on the runtime.
export { RoutingReason };
export type { RoutingReasonType };

/**
 * RoutingResult - Message delivery result (Value Object)
 *
 * Immutable object representing the result of a message dispatch operation.
 * Can only be created through the static factory method create().
 */
export class RoutingResult<TResponse = unknown> implements RoutingResultShape<TResponse> {
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
