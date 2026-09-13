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
