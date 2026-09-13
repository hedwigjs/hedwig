import { randomUUID } from 'node:crypto';

/**
 * The one place the backend builds a broker frame.
 *
 * The shape mirrors `@hedwigjs/broker`'s `Message` on the wire (see
 * packages/broker/README.md, "Message shape"): the bridges on the page
 * validate `topic`, `source`, `target` and the presence of `data` before
 * injecting. The wire spec + JSON Schema land in a later step; until then
 * this helper is the single source of truth so the three routes cannot
 * drift apart.
 *
 * `id` is a UUID, not a per-process counter: counters restart with the
 * process and would hand out the same ids after every deploy.
 */
export interface Envelope<Topic extends string = string, Data = unknown> {
  id: string;
  topic: Topic;
  source: string;
  target: string;
  data: Data;
  timestamp: number;
}

export function createEnvelope<Topic extends string, Data>(input: {
  topic: Topic;
  source: string;
  data: Data;
  target?: string;
}): Envelope<Topic, Data> {
  return {
    id: randomUUID(),
    topic: input.topic,
    source: input.source,
    target: input.target ?? '*',
    data: input.data,
    timestamp: Date.now(),
  };
}
