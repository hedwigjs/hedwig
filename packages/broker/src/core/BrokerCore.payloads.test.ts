import { BrokerCore } from './BrokerCore';
import { BrokerClient } from './client/BrokerClient';

/**
 * What happens to the emitter's `data` object: frozen in place by default,
 * copied first with `payloads: 'clone'`.
 */
describe('payloads', () => {
  test("default: the emitter's object is frozen in place and handlers see that same object", async () => {
    const core = new BrokerCore<'a.v1', { 'a.v1': { items: number[] } }>();
    const seen: unknown[] = [];
    new BrokerClient('sub', core).on('a.v1', (m) => void seen.push(m.data));
    const payload = { items: [1] };

    await new BrokerClient('pub', core).emit('a.v1', payload);

    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.items)).toBe(true);
    expect(seen[0]).toBe(payload);
    expect(() => {
      (payload as { items: number[] }).items = [];
    }).toThrow();
    core.destroy();
  });

  test("payloads: 'clone' — the emitter keeps a mutable original, handlers get a frozen copy", async () => {
    const core = new BrokerCore<'a.v1', { 'a.v1': { items: number[] } }>({ payloads: 'clone' });
    const seen: Array<{ items: number[] }> = [];
    new BrokerClient('sub', core).on('a.v1', (m) => void seen.push(m.data));
    const payload = { items: [1] };

    await new BrokerClient('pub', core).emit('a.v1', payload);
    payload.items.push(2); // still ours to change

    expect(Object.isFrozen(payload)).toBe(false);
    expect(seen[0]).not.toBe(payload);
    expect(seen[0]).toEqual({ items: [1] });
    expect(Object.isFrozen(seen[0])).toBe(true);
    core.destroy();
  });

  test("payloads: 'clone' — a payload structuredClone cannot copy is NACK SERIALIZATION_FAILED", async () => {
    const warn = jest.fn();
    const core = new BrokerCore<'a.v1', { 'a.v1': { run: () => void } }>({
      payloads: 'clone',
      logger: { warn, error: jest.fn() },
    });
    const handler = jest.fn();
    new BrokerClient('sub', core).on('a.v1', handler);

    const result = await new BrokerClient('pub', core).emit('a.v1', { run: () => {} });

    expect(result).toMatchObject({ status: 'NACK', reason: 'SERIALIZATION_FAILED' });
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('emit.payload.not_cloneable', expect.objectContaining({ topic: 'a.v1', sender: 'pub' }));
    core.destroy();
  });
});
