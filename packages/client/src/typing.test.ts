import { createClient } from './index';

/**
 * Kind-aware verbs are a compile-time feature. ts-jest type-checks this
 * file, so a wrong verb that *stops* being an error fails the suite via an
 * unused `@ts-expect-error`.
 */

type T = 'a.v1' | 'r.v1' | 's.v1';
type P = { 'a.v1': { n: number }; 'r.v1': { q: string }; 's.v1': { v: number } };
type C = {
  'a.v1': { kind: 'event'; response: never };
  'r.v1': { kind: 'request'; response: { ok: boolean } };
  's.v1': { kind: 'state'; response: never };
};

test('the generated TopicContracts constrain emit / request and infer the answer', async () => {
  const c = createClient<T, P, C>('typed');

  void c.emit('a.v1', { n: 1 });
  void c.emit('s.v1', { v: 1 });
  // @ts-expect-error a request topic cannot be emitted
  void c.emit('r.v1', { q: 'x' });

  const answer = c.request('cart', 'r.v1', { q: 'x' });
  // @ts-expect-error an event topic cannot be requested
  void c.request('cart', 'a.v1', { n: 1 });
  // @ts-expect-error a state topic cannot be requested
  void c.request('cart', 's.v1', { v: 1 });

  const result = await Promise.race([answer, Promise.resolve(null)]);
  const typed: { ok: boolean } | undefined = result?.data;
  expect(typed).toBeUndefined();
  c.destroy();
});

test('without contracts every topic is open to both verbs, as before', () => {
  const loose = createClient<T, P>('loose');
  void loose.emit('r.v1', { q: 'x' });
  void loose.request<'a.v1', { anything: true }>('cart', 'a.v1', { n: 1 });
  loose.destroy();
});
