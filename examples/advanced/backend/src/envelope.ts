import { randomUUID } from 'node:crypto';

/**
 * The one place the backend builds a wire frame.
 *
 * Shape: Hedwig wire envelope v1 — `docs/content/spec/envelope-v1.md`,
 * JSON Schema at `packages/broker/spec/envelope-v1.schema.json`. The
 * backend depends on the spec only, not on any Hedwig package; the test
 * next to this file validates every frame this helper produces against
 * the schema.
 *
 * - `id` is a UUID, not a per-process counter: counters restart with the
 *   process and would hand out the same ids after every deploy. The
 *   browser keeps it as `wireId`; `(source, wireId)` is the cross-realm
 *   correlation key.
 * - `origin` is this process's session id (one per start). The receiving
 *   runtime drops frames stamped with its *own* origin — the echo guard —
 *   so a backend that relays browser frames must never copy `origin`.
 */
export const WIRE_VERSION = 1 as const;

/** Session id of this backend process — the frame `origin`. */
export const ORIGIN = `backend-${randomUUID()}`;

export interface Envelope<Topic extends string = string, Data = unknown> {
  v: typeof WIRE_VERSION;
  id: string;
  origin: string;
  kind: 'event';
  topic: Topic;
  source: string;
  target: string;
  data: Data;
  timestamp: number;
  correlationId?: string;
  ext?: Record<string, unknown>;
}

/** Flat outcome of a request that reached this backend. */
export interface ResponseEnvelope<Data = unknown> {
  v: typeof WIRE_VERSION;
  id: string;
  origin: string;
  kind: 'response';
  correlationId: string;
  topic: string;
  source: string;
  target: string;
  status: 'ACK' | 'NACK';
  reason: 'DELIVERED' | 'HOOK_REJECTED' | 'NOT_SUBSCRIBED' | 'HANDLER_FAILED' | 'TIMEOUT' | 'BROKER_DESTROYED' | 'SERIALIZATION_FAILED';
  message?: string;
  data?: Data;
  timestamp: number;
}

/**
 * Answer a `kind: 'request'` frame. `correlationId` is the request's
 * `correlationId` (or its `id`), `source` is us (the request's `target`),
 * `target` is the requester (the request's `source`). `reason` is the
 * spec's closed set — the browser maps it onto its own `RoutingReason`.
 */
export function createResponse<Data>(input: {
  correlationId: string;
  topic: string;
  source: string;
  target: string;
  status: 'ACK' | 'NACK';
  reason: ResponseEnvelope['reason'];
  message?: string;
  data?: Data;
}): ResponseEnvelope<Data> {
  const frame: ResponseEnvelope<Data> = {
    v: WIRE_VERSION,
    id: randomUUID(),
    origin: ORIGIN,
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
  return frame;
}

/**
 * Minimal reading of an inbound frame: enough to tell a request apart and
 * answer it. The browser runtime validates everything it sends per the
 * schema; a backend that exposes the socket to the world should validate
 * with the schema too.
 */
export interface InboundRequest {
  correlationId: string;
  topic: string;
  source: string;
  target: string;
  data: unknown;
}

export function readRequest(raw: unknown): InboundRequest | null {
  let frame: unknown = raw;
  if (typeof raw === 'string') {
    try {
      frame = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!frame || typeof frame !== 'object') return null;
  const f = frame as Record<string, unknown>;
  const kind = f.kind ?? (f.target === '*' ? 'event' : 'request');
  if (kind !== 'request') return null;
  const correlationId = typeof f.correlationId === 'string' ? f.correlationId : typeof f.id === 'string' ? f.id : null;
  if (correlationId === null) return null;
  if (typeof f.topic !== 'string' || typeof f.target !== 'string' || !('data' in f)) return null;
  return {
    correlationId,
    topic: f.topic,
    source: typeof f.source === 'string' ? f.source : f.target,
    target: f.target,
    data: f.data,
  };
}

export function createEnvelope<Topic extends string, Data>(input: {
  topic: Topic;
  source: string;
  data: Data;
  target?: string;
  /** Groups a streamed partial result (e.g. every chunk of one AI reply). */
  correlationId?: string;
  ext?: Record<string, unknown>;
}): Envelope<Topic, Data> {
  const frame: Envelope<Topic, Data> = {
    v: WIRE_VERSION,
    id: randomUUID(),
    origin: ORIGIN,
    kind: 'event',
    topic: input.topic,
    source: input.source,
    target: input.target ?? '*',
    data: input.data,
    timestamp: Date.now(),
  };
  if (input.correlationId !== undefined) frame.correlationId = input.correlationId;
  if (input.ext !== undefined) frame.ext = input.ext;
  return frame;
}
