import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

import { createEnvelope, ORIGIN, WIRE_VERSION } from './envelope.js';
import { iframeHtml } from './routes/checkout.js';

/**
 * The backend has no Hedwig dependency; its contract with the browser is
 * the wire spec. This test pins every frame the backend produces to the
 * published JSON Schema.
 */
const schemaUrl = new URL('../../../../packages/broker/spec/envelope-v1.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function assertValid(frame: unknown): void {
  const ok = validate(frame);
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
}

test('notification envelope is a valid v1 event', () => {
  const frame = createEnvelope({
    topic: 'notification.show.v1',
    source: 'notifications-backend',
    data: { kind: 'info', title: 'Hi' },
  });
  assertValid(frame);
  assert.equal(frame.v, WIRE_VERSION);
  assert.equal(frame.kind, 'event');
  assert.equal(frame.target, '*');
  assert.equal(frame.origin, ORIGIN);
  assert.match(frame.id, /^[0-9a-f-]{36}$/);
});

test('AI stream frames share one correlationId and validate', () => {
  const chunk = createEnvelope({
    topic: 'chat.reply-chunk.v1',
    source: 'ai-backend',
    data: { replyId: 'r1', chunk: 'He' },
    correlationId: 'r1',
  });
  const done = createEnvelope({
    topic: 'chat.reply-completed.v1',
    source: 'ai-backend',
    data: { replyId: 'r1', fullText: 'Hello' },
    correlationId: 'r1',
  });
  assertValid(chunk);
  assertValid(done);
  assert.equal(chunk.correlationId, done.correlationId);
  assert.notEqual(chunk.id, done.id);
});

test('ext is carried through untouched and stays schema-valid', () => {
  const frame = createEnvelope({
    topic: 'notification.show.v1',
    source: 'notifications-backend',
    data: {},
    ext: { traceparent: '00-abc-def-01', custom: { deep: [1, 2] } },
  });
  assertValid(frame);
  assert.deepEqual(frame.ext, { traceparent: '00-abc-def-01', custom: { deep: [1, 2] } });
});

test('a frame that copies a browser origin would be an echo — the helper never does that', () => {
  const frame = createEnvelope({ topic: 'x.v1', source: 's', data: null });
  assert.equal(frame.origin, ORIGIN);
  assert.ok(ORIGIN.startsWith('backend-'));
});

test('the checkout iframe posts a v1 event frame with its own origin', () => {
  const html = iframeHtml('en');
  const start = html.indexOf('window.parent?.postMessage(');
  assert.ok(start > 0, 'iframe script posts to the parent');
  const script = html.slice(start, html.indexOf('parentOrigin,', start));
  for (const needle of ["v: 1", "kind: 'event'", "origin: IFRAME_ORIGIN", "topic: 'checkout.completed.v1'", "source: 'checkout-iframe'", "target: '*'"]) {
    assert.ok(script.includes(needle), `frame literal contains ${needle}`);
  }
  // The literal, evaluated the way the browser would, must validate.
  const frame = {
    v: 1,
    id: 'checkout-iframe-A-1',
    origin: 'checkout-iframe-abc',
    kind: 'event',
    topic: 'checkout.completed.v1',
    source: 'checkout-iframe',
    target: '*',
    data: { orderId: 'A-1' },
    timestamp: Date.now(),
  };
  assertValid(frame);
});
