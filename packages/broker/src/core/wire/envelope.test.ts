import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { parseFrame, buildFrame, WIRE_VERSION } from './envelope';

/**
 * The runtime does not embed a JSON Schema validator; `parseFrame` is a
 * structural check that must agree with `spec/envelope-v1.schema.json`.
 * This suite is that agreement: every frame in the corpus is fed to both
 * and they must reach the same verdict (schema `valid` ⇔ parse `ok`).
 */

const schema = JSON.parse(readFileSync(join(__dirname, '../../../spec/envelope-v1.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

const event = { v: 1, id: 'e-1', origin: 'realm-a', kind: 'event', topic: 'a.v1', source: 's', target: '*', data: { n: 1 }, timestamp: 1 };
const request = { ...event, id: 'r-1', kind: 'request', target: 'cart', correlationId: 'r-1', deadline: 5000 };
const response = { v: 1, id: 'p-1', origin: 'realm-b', kind: 'response', correlationId: 'r-1', topic: 'a.v1', source: 'cart', target: 's', status: 'ACK', reason: 'DELIVERED', data: { ok: true } };

const corpus: Array<[string, unknown, boolean]> = [
  ['full event', event, true],
  ['full request', request, true],
  ['full response', response, true],
  ['minimal legacy frame (no v, no kind, no source)', { topic: 'a.v1', target: '*', data: null }, true],
  ['data: null is a value', { ...event, data: null }, true],
  ['unknown top-level field is ignored', { ...event, whatever: 42 }, true],
  ['ext with traceparent and hedwig block', { ...event, ext: { traceparent: '00-abc', hedwig: { claimedSource: 's' }, custom: 1 } }, true],
  ['NACK response with message and details', { ...response, status: 'NACK', reason: 'HANDLER_FAILED', message: 'boom', details: { code: 7 } }, true],
  ['empty topic', { ...event, topic: '' }, false],
  ['missing target', { topic: 'a.v1', data: 1 }, false],
  ['missing data', { topic: 'a.v1', target: '*' }, false],
  ['empty source', { ...event, source: '' }, false],
  ['numeric source', { ...event, source: 7 }, false],
  ['string timestamp', { ...event, timestamp: 'now' }, false],
  ['negative timestamp', { ...event, timestamp: -1 }, false],
  ['fractional deadline', { ...request, deadline: 1.5 }, false],
  ['ext is an array', { ...event, ext: [] }, false],
  ['v: 2', { ...event, v: 2 }, false],
  ['v: "1"', { ...event, v: '1' }, false],
  ['kind: gossip', { ...event, kind: 'gossip' }, false],
  ['kind: 7', { ...event, kind: 7 }, false],
  ['response without correlationId', { ...response, correlationId: undefined }, false],
  ['response without source', { ...response, source: undefined }, false],
  ['response with status MAYBE', { ...response, status: 'MAYBE' }, false],
  ['response with open-ended reason', { ...response, reason: 'REMOTE_GONE' }, false],
  ['response with non-string message', { ...response, message: 42 }, false],
  ['array frame', [1, 2], false],
  ['null frame', null, false],
  ['number frame', 42, false],
];

describe('parseFrame agrees with envelope-v1.schema.json', () => {
  test.each(corpus)('%s', (_name, frame, expected) => {
    const bySchema = validate(frame);
    const byRuntime = parseFrame(frame).ok;
    expect(bySchema).toBe(expected);
    expect(byRuntime).toBe(expected);
  });

  test('a JSON string is parsed first; unparsable text is MALFORMED', () => {
    expect(parseFrame(JSON.stringify(event)).ok).toBe(true);
    expect(parseFrame('{not json')).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

describe('parseFrame semantics', () => {
  test('kind defaults from target when missing', () => {
    const e = parseFrame({ topic: 'a.v1', target: '*', data: 1 });
    const r = parseFrame({ topic: 'a.v1', target: 'cart', data: 1 });
    expect(e.ok && e.frame.kind).toBe('event');
    expect(r.ok && r.frame.kind).toBe('request');
  });

  test('unsupported version and kind are UNSUPPORTED, not MALFORMED', () => {
    expect(parseFrame({ ...event, v: 2 })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
    expect(parseFrame({ ...event, kind: 'cancel' })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
  });

  test('a response is returned flat with its closed reason', () => {
    const r = parseFrame(response);
    expect(r.ok && r.frame).toMatchObject({ kind: 'response', correlationId: 'r-1', status: 'ACK', reason: 'DELIVERED', data: { ok: true } });
  });

  test('ext is passed through untouched', () => {
    const ext = { traceparent: '00-abc', hedwig: { claimedSource: 's' }, custom: { deep: [1] } };
    const r = parseFrame({ ...event, ext });
    expect(r.ok && r.frame.ext).toEqual(ext);
  });
});

describe('buildFrame', () => {
  test('emits v1 with origin and kind, and never copies local-only flags', () => {
    const frame = buildFrame(
      {
        id: 'm-1',
        topic: 'a.v1',
        source: 'cart',
        target: '*',
        data: { n: 1 },
        timestamp: 7,
        replayed: true,
        fromExternal: true,
        synthetic: true,
        via: 'x',
        wireId: 'w',
        ext: { traceparent: 't' },
      },
      'realm-a',
    );
    expect(frame).toEqual({
      v: WIRE_VERSION,
      id: 'm-1',
      origin: 'realm-a',
      kind: 'event',
      topic: 'a.v1',
      source: 'cart',
      target: '*',
      data: { n: 1 },
      timestamp: 7,
    });
    expect(validate(frame)).toBe(true);
  });

  test('a unicast becomes kind: request', () => {
    const frame = buildFrame({ id: 'm', topic: 'a.v1', source: 'a', target: 'b', data: 1, timestamp: 1 }, 'o');
    expect(frame.kind).toBe('request');
    expect(validate(frame)).toBe(true);
  });
});
