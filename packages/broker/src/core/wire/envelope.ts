import type { Message } from '../types';

/**
 * Wire envelope v1 — the frame a transport carries between a runtime and a
 * remote client. Specified in `docs/content/spec/envelope-v1.md`; the
 * JSON Schema ships as `@hedwigjs/broker/spec/envelope-v1.schema.json`.
 *
 * The runtime does not embed a schema validator: {@link parseFrame} is a
 * structural check equivalent to the schema (the test suite proves the two
 * agree on a corpus of frames).
 */

/** The only wire version this runtime produces and accepts. */
export const WIRE_VERSION = 1 as const;

export type WireKind = 'event' | 'request' | 'response';

/** Closed set of reasons a response may carry. */
export const WIRE_RESPONSE_REASONS = [
  'DELIVERED',
  'HOOK_REJECTED',
  'NOT_SUBSCRIBED',
  'HANDLER_FAILED',
  'TIMEOUT',
  'BROKER_DESTROYED',
  'SERIALIZATION_FAILED',
] as const;
export type WireResponseReason = (typeof WIRE_RESPONSE_REASONS)[number];

/** Opaque extension block; `hedwig.*` is runtime-owned. */
export type WireExt = Record<string, unknown> & {
  traceparent?: string;
  tracestate?: string;
  hedwig?: Record<string, unknown> & { claimedSource?: string };
};

/** An event or a request as it travels on the wire. */
export interface WireMessage<T extends string = string, D = unknown> {
  v?: 1;
  id?: string;
  origin?: string;
  kind?: 'event' | 'request';
  topic: T;
  source?: string;
  target: string;
  data: D;
  timestamp?: number;
  correlationId?: string;
  deadline?: number;
  ext?: WireExt;
}

/** The flat outcome of a request as it travels on the wire. */
export interface WireResponse<D = unknown> {
  v?: 1;
  id?: string;
  origin?: string;
  kind: 'response';
  correlationId: string;
  topic: string;
  source: string;
  target: string;
  status: 'ACK' | 'NACK';
  reason: WireResponseReason;
  message?: string;
  data?: D;
  details?: unknown;
  timestamp?: number;
  ext?: WireExt;
}

export type WireFrame = WireMessage | WireResponse;

/** {@link WireMessage} after parsing: `kind` resolved, optional fields typed. */
export interface ParsedWireMessage {
  kind: 'event' | 'request';
  v: 1 | undefined;
  id: string | undefined;
  origin: string | undefined;
  topic: string;
  source: string | undefined;
  target: string;
  data: unknown;
  timestamp: number | undefined;
  correlationId: string | undefined;
  deadline: number | undefined;
  ext: WireExt | undefined;
}

export type ParsedWireFrame = ParsedWireMessage | (WireResponse & { v: 1 | undefined });

export type ParseFailure = 'MALFORMED' | 'UNSUPPORTED';

export type ParseResult = { ok: true; frame: ParsedWireFrame } | { ok: false; reason: ParseFailure };

const isNonEmptyString = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isOptionalNonEmptyString = (x: unknown): x is string | undefined => x === undefined || isNonEmptyString(x);
const isOptionalTimestamp = (x: unknown): x is number | undefined =>
  x === undefined || (typeof x === 'number' && Number.isInteger(x) && x >= 0);
const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

/**
 * Structural check of one inbound frame, equivalent to the JSON Schema.
 *
 * - `MALFORMED`: not an object (or unparsable JSON string), a required
 *   field missing, or a field of the wrong type.
 * - `UNSUPPORTED`: `v` other than 1, or a `kind` this runtime does not know.
 *
 * Missing `v` and `kind` are tolerated; `kind` defaults to
 * `target === '*' ? 'event' : 'request'`. Unknown extra fields are ignored.
 */
export function parseFrame(raw: unknown): ParseResult {
  let frame: unknown = raw;
  if (typeof raw === 'string') {
    try {
      frame = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'MALFORMED' };
    }
  }
  if (!isPlainObject(frame)) return { ok: false, reason: 'MALFORMED' };
  const f = frame;

  if (f.v !== undefined) {
    if (typeof f.v !== 'number') return { ok: false, reason: 'MALFORMED' };
    if (f.v !== WIRE_VERSION) return { ok: false, reason: 'UNSUPPORTED' };
  }
  if (f.kind !== undefined) {
    if (typeof f.kind !== 'string') return { ok: false, reason: 'MALFORMED' };
    if (f.kind !== 'event' && f.kind !== 'request' && f.kind !== 'response') {
      return { ok: false, reason: 'UNSUPPORTED' };
    }
  }

  // Fields shared by both shapes.
  if (!isNonEmptyString(f.topic)) return { ok: false, reason: 'MALFORMED' };
  if (!isNonEmptyString(f.target)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalNonEmptyString(f.id)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalNonEmptyString(f.origin)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalNonEmptyString(f.source)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalTimestamp(f.timestamp)) return { ok: false, reason: 'MALFORMED' };
  if (f.ext !== undefined && !isPlainObject(f.ext)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalNonEmptyString(f.correlationId)) return { ok: false, reason: 'MALFORMED' };

  if (f.kind === 'response') {
    if (!isNonEmptyString(f.correlationId)) return { ok: false, reason: 'MALFORMED' };
    if (!isNonEmptyString(f.source)) return { ok: false, reason: 'MALFORMED' };
    if (f.status !== 'ACK' && f.status !== 'NACK') return { ok: false, reason: 'MALFORMED' };
    if (typeof f.reason !== 'string' || !(WIRE_RESPONSE_REASONS as readonly string[]).includes(f.reason)) {
      return { ok: false, reason: 'MALFORMED' };
    }
    if (f.message !== undefined && typeof f.message !== 'string') return { ok: false, reason: 'MALFORMED' };
    return {
      ok: true,
      frame: {
        v: f.v as 1 | undefined,
        id: f.id as string | undefined,
        origin: f.origin as string | undefined,
        kind: 'response',
        correlationId: f.correlationId,
        topic: f.topic,
        source: f.source,
        target: f.target,
        status: f.status,
        reason: f.reason as WireResponseReason,
        message: f.message as string | undefined,
        data: f.data,
        details: f.details,
        timestamp: f.timestamp as number | undefined,
        ext: f.ext as WireExt | undefined,
      },
    };
  }

  if (!('data' in f)) return { ok: false, reason: 'MALFORMED' };
  if (!isOptionalTimestamp(f.deadline)) return { ok: false, reason: 'MALFORMED' };
  // A request names one recipient; an explicit `kind: 'request'` with the
  // multicast target is a contradiction the schema also refuses.
  if (f.kind === 'request' && f.target === '*') return { ok: false, reason: 'MALFORMED' };
  const kind: 'event' | 'request' =
    f.kind === 'event' || f.kind === 'request' ? f.kind : f.target === '*' ? 'event' : 'request';
  return {
    ok: true,
    frame: {
      kind,
      v: f.v as 1 | undefined,
      id: f.id as string | undefined,
      origin: f.origin as string | undefined,
      topic: f.topic,
      source: f.source as string | undefined,
      target: f.target,
      data: f.data,
      timestamp: f.timestamp as number | undefined,
      correlationId: f.correlationId as string | undefined,
      deadline: f.deadline as number | undefined,
      ext: f.ext as WireExt | undefined,
    },
  };
}

/**
 * Build the outbound frame for a local message. Only wire fields are
 * copied — local-only flags (`replayed`, `fromExternal`, `synthetic`,
 * `via`, `wireId`, `ext`) never leave the realm. A request carries its
 * own id as `correlationId` and an absolute `deadline` when it has a
 * timeout.
 */
export function buildFrame(
  message: Message,
  origin: string,
  options?: { correlationId?: string; deadline?: number },
): WireMessage {
  const frame: WireMessage = {
    v: WIRE_VERSION,
    id: message.id,
    origin,
    kind: message.target === '*' ? 'event' : 'request',
    topic: message.topic,
    source: message.source,
    target: message.target,
    data: message.data,
    timestamp: message.timestamp,
  };
  if (options?.correlationId !== undefined) frame.correlationId = options.correlationId;
  if (options?.deadline !== undefined) frame.deadline = options.deadline;
  return frame;
}

/**
 * Build the flat response frame for a request that arrived over a wire.
 * `source` is the responder (the request's `target`), `target` the
 * requester (the request's `source`). No stack traces: `message` is a
 * one-line summary.
 */
export function buildResponse(input: {
  id: string;
  origin: string;
  correlationId: string;
  topic: string;
  source: string;
  target: string;
  status: 'ACK' | 'NACK';
  reason: WireResponseReason;
  message?: string;
  data?: unknown;
  details?: unknown;
}): WireResponse {
  const frame: WireResponse = {
    v: WIRE_VERSION,
    id: input.id,
    origin: input.origin,
    kind: 'response',
    correlationId: input.correlationId,
    topic: input.topic,
    source: input.source,
    target: input.target,
    status: input.status,
    reason: input.reason,
    timestamp: Date.now(),
  };
  if (input.message !== undefined) frame.message = input.message;
  if (input.data !== undefined) frame.data = input.data;
  if (input.details !== undefined) frame.details = input.details;
  return frame;
}

/**
 * Map a local routing reason onto the closed wire enum. Reasons that only
 * make sense locally (`DISPATCHED`, `REPLAY_DELIVERED`, `DEBUG_DISABLED`,
 * `NO_SUBSCRIBERS`, the `REMOTE_*` / `TRANSPORT_*` family) collapse to
 * `HANDLER_FAILED` with the original reason kept in `details`.
 */
export function toWireReason(reason: string): { reason: WireResponseReason; exact: boolean } {
  return (WIRE_RESPONSE_REASONS as readonly string[]).includes(reason)
    ? { reason: reason as WireResponseReason, exact: true }
    : { reason: 'HANDLER_FAILED', exact: false };
}
