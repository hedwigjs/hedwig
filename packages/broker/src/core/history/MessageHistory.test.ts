import { MessageHistory } from './MessageHistory';
import type { Message } from '../types';

let counter = 0;
const msg = (topic: string, source: string, data: any, timestamp = Date.now()): Message<string, any> => ({
  id: `m-${++counter}`,
  topic,
  source,
  target: '*',
  data,
  timestamp,
});

const topicsOf = (entries: ReadonlyArray<{ message: { topic: string } }>) => entries.map((e) => e.message.topic);

describe('MessageHistory', () => {
  describe('retention is declared per topic', () => {
    test('records only topics that retain; anything else is dropped', () => {
      const history = new MessageHistory();
      history.retain('feed.v1', 3);

      expect(history.record(msg('feed.v1', 'a', { n: 1 }))).toBe(true);
      expect(history.record(msg('noise.v1', 'a', { n: 2 }))).toBe(false);

      expect(history.retains('feed.v1')).toBe(true);
      expect(history.retains('noise.v1')).toBe(false);
      expect(history.getStats().count).toBe(1);
    });

    test('every topic has its own ring: a chatty topic never evicts another one', () => {
      const history = new MessageHistory();
      history.retain('chatty.v1', 2);
      history.retain('quiet.v1', 2);

      history.record(msg('quiet.v1', 'a', { n: 0 }));
      for (let i = 1; i <= 5; i++) history.record(msg('chatty.v1', 'a', { n: i }));

      expect(history.querySync({ topics: ['chatty.v1'] }).map((e) => e.message.data.n)).toEqual([4, 5]);
      expect(history.querySync({ topics: ['quiet.v1'] }).map((e) => e.message.data.n)).toEqual([0]);
    });

    test('sequence numbers are global, so a cross-topic query comes back in emit order', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 10);
      history.retain('b.v1', 10);
      history.record(msg('a.v1', 's', 1));
      history.record(msg('b.v1', 's', 2));
      history.record(msg('a.v1', 's', 3));

      const all = history.querySync();
      expect(topicsOf(all)).toEqual(['a.v1', 'b.v1', 'a.v1']);
      expect(all.map((e) => e.sequence)).toEqual([0, 1, 2]);
    });

    test('a state topic keeps exactly one value whatever limit is passed', () => {
      const history = new MessageHistory();
      history.retain('cart.snapshot.v1', 5, 'state');
      history.record(msg('cart.snapshot.v1', 'store', { items: 1 }));
      history.record(msg('cart.snapshot.v1', 'store', { items: 2 }));
      history.record(msg('cart.snapshot.v1', 'store', { items: 3 }));

      expect(history.last('cart.snapshot.v1')?.message.data).toEqual({ items: 3 });
      expect(history.getStats().topics).toEqual([{ topic: 'cart.snapshot.v1', kind: 'state', limit: 1, count: 1 }]);
    });

    test('retainsMatching answers for globs', () => {
      const history = new MessageHistory();
      history.retain('chat.message-sent.v1', 50);
      expect(history.retainsMatching('chat.*')).toBe(true);
      expect(history.retainsMatching('chat.message-sent.v1')).toBe(true);
      expect(history.retainsMatching('cart.*')).toBe(false);
    });

    test('re-declaring a topic updates its limit and trims to it', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 5);
      for (let i = 1; i <= 5; i++) history.record(msg('a.v1', 's', i));
      history.retain('a.v1', 2);
      expect(history.querySync().map((e) => e.message.data)).toEqual([4, 5]);
    });

    test('recorded messages are frozen', () => {
      const history = new MessageHistory();
      history.retain('t.v1', 1);
      history.record(msg('t.v1', 's', { value: 1 }));
      const stored = history.querySync()[0]!.message;
      expect(() => {
        (stored as any).topic = 'modified';
      }).toThrow();
    });

    test('last() is undefined for an empty or undeclared topic', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 3);
      expect(history.last('a.v1')).toBeUndefined();
      expect(history.last('nope.v1')).toBeUndefined();
    });
  });

  describe('host limits', () => {
    test('enabled: false switches event retention off but keeps state', () => {
      const history = new MessageHistory({ enabled: false });
      history.retain('feed.v1', 10);
      history.retain('cart.snapshot.v1', 1, 'state');

      expect(history.enabled).toBe(false);
      expect(history.record(msg('feed.v1', 's', 1))).toBe(false);
      expect(history.record(msg('cart.snapshot.v1', 's', 1))).toBe(true);
      expect(history.getStats().topics.map((t) => t.topic)).toEqual(['cart.snapshot.v1']);
    });

    test('maxPerTopic caps declared event limits, never state', () => {
      const history = new MessageHistory({ maxPerTopic: 2 });
      history.retain('feed.v1', 10);
      history.retain('cart.snapshot.v1', 1, 'state');
      for (let i = 1; i <= 4; i++) history.record(msg('feed.v1', 's', i));

      expect(history.getStats().topics).toEqual([
        { topic: 'cart.snapshot.v1', kind: 'state', limit: 1, count: 0 },
        { topic: 'feed.v1', kind: 'event', limit: 2, count: 2 },
      ]);
    });

    test('a limit below one declares nothing', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 0);
      history.retain('b.v1', -3);
      expect(history.retains('a.v1')).toBe(false);
      expect(history.retains('b.v1')).toBe(false);
    });

    describe('ttl', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      test('expires retained events, never a state value', () => {
        const history = new MessageHistory({ ttl: 1000 });
        history.retain('feed.v1', 10);
        history.retain('cart.snapshot.v1', 1, 'state');
        history.record(msg('feed.v1', 's', 1));
        history.record(msg('cart.snapshot.v1', 's', { items: 1 }));
        expect(history.getStats().count).toBe(2);

        jest.advanceTimersByTime(1500);

        expect(history.querySync({ topics: ['feed.v1'] })).toHaveLength(0);
        expect(history.last('cart.snapshot.v1')?.message.data).toEqual({ items: 1 });
        history.destroy();
      });

      test('keeps events within the ttl', () => {
        const history = new MessageHistory({ ttl: 5000 });
        history.retain('feed.v1', 10);
        history.record(msg('feed.v1', 's', 1));
        jest.advanceTimersByTime(3000);
        expect(history.getStats().count).toBe(1);
        history.destroy();
      });

      test('starts a timer only when a ttl is set, and destroy() stops it', () => {
        expect(jest.getTimerCount()).toBe(0);
        new MessageHistory();
        expect(jest.getTimerCount()).toBe(0);
        const withTtl = new MessageHistory({ ttl: 1000 });
        expect(jest.getTimerCount()).toBe(1);
        withTtl.destroy();
        expect(jest.getTimerCount()).toBe(0);
      });
    });
  });

  describe('querySync()', () => {
    function seeded() {
      const history = new MessageHistory();
      for (const t of ['user.login.v1', 'user.logout.v1', 'cart.add.v1', 'cart.remove.v1', 'cart.add.v2']) history.retain(t, 10);
      history.record(msg('user.login.v1', 'mfe-auth', {}, 100));
      history.record(msg('cart.add.v1', 'mfe-cart', {}, 200));
      history.record(msg('user.logout.v1', 'mfe-auth', {}, 300));
      history.record(msg('cart.remove.v1', 'mfe-cart', {}, 400));
      history.record(msg('cart.add.v2', 'mfe-cart', {}, 500));
      return history;
    }

    test('no filter returns everything in emit order; an empty history returns []', () => {
      expect(topicsOf(seeded().querySync())).toEqual(['user.login.v1', 'cart.add.v1', 'user.logout.v1', 'cart.remove.v1', 'cart.add.v2']);
      expect(new MessageHistory().querySync()).toEqual([]);
    });

    test('filters by exact topic, by glob (end and middle), and by several patterns', () => {
      const history = seeded();
      expect(topicsOf(history.querySync({ topics: ['cart.add.v1'] }))).toEqual(['cart.add.v1']);
      expect(topicsOf(history.querySync({ topics: ['user.*'] }))).toEqual(['user.login.v1', 'user.logout.v1']);
      expect(topicsOf(history.querySync({ topics: ['cart.*.v1'] }))).toEqual(['cart.add.v1', 'cart.remove.v1']);
      expect(topicsOf(history.querySync({ topics: ['*.v2'] }))).toEqual(['cart.add.v2']);
      expect(topicsOf(history.querySync({ topics: ['user.login.v1', 'cart.add.v1'] }))).toEqual(['user.login.v1', 'cart.add.v1']);
      expect(history.querySync({ topics: ['user.login.v2'] })).toEqual([]);
    });

    test('filters by source and by time window', () => {
      const history = seeded();
      expect(topicsOf(history.querySync({ sources: ['mfe-auth'] }))).toEqual(['user.login.v1', 'user.logout.v1']);
      expect(topicsOf(history.querySync({ since: 300 }))).toEqual(['user.logout.v1', 'cart.remove.v1', 'cart.add.v2']);
      expect(topicsOf(history.querySync({ until: 200 }))).toEqual(['user.login.v1', 'cart.add.v1']);
      expect(topicsOf(history.querySync({ since: 200, until: 400 }))).toEqual(['cart.add.v1', 'user.logout.v1', 'cart.remove.v1']);
    });

    test('limit keeps the newest N across topics', () => {
      expect(topicsOf(seeded().querySync({ limit: 2 }))).toEqual(['cart.remove.v1', 'cart.add.v2']);
    });

    test('filters combine', () => {
      expect(topicsOf(seeded().querySync({ topics: ['cart.*'], sources: ['mfe-cart'], since: 300, limit: 10 }))).toEqual([
        'cart.remove.v1',
        'cart.add.v2',
      ]);
    });

    test('query() is the async twin of querySync()', async () => {
      expect(topicsOf(await seeded().query({ topics: ['user.*'] }))).toEqual(['user.login.v1', 'user.logout.v1']);
    });
  });

  describe('clear()', () => {
    function seeded() {
      const history = new MessageHistory();
      for (const t of ['user.login.v1', 'user.logout.v1', 'cart.add.v1']) history.retain(t, 10);
      history.record(msg('user.login.v1', 'mfe-auth', {}, 100));
      history.record(msg('cart.add.v1', 'mfe-cart', {}, 200));
      history.record(msg('user.logout.v1', 'mfe-auth', {}, 300));
      return history;
    }

    test('clears everything but keeps the topics declared', async () => {
      const history = seeded();
      await history.clear();
      expect(history.getStats().count).toBe(0);
      expect(history.retains('user.login.v1')).toBe(true);
    });

    test('clears by topic pattern, by source, and by time window', async () => {
      let history = seeded();
      await history.clear({ topics: ['user.*'] });
      expect(topicsOf(history.querySync())).toEqual(['cart.add.v1']);

      history = seeded();
      await history.clear({ sources: ['mfe-auth'] });
      expect(topicsOf(history.querySync())).toEqual(['cart.add.v1']);

      history = seeded();
      await history.clear({ until: 150 });
      expect(topicsOf(history.querySync())).toEqual(['cart.add.v1', 'user.logout.v1']);
    });
  });

  describe('getStats()', () => {
    test('lists every declared topic even when nothing was recorded yet', () => {
      const history = new MessageHistory();
      history.retain('b.v1', 3);
      history.retain('a.v1', 2);
      expect(history.getStats()).toEqual({
        count: 0,
        topics: [
          { topic: 'a.v1', kind: 'event', limit: 2, count: 0 },
          { topic: 'b.v1', kind: 'event', limit: 3, count: 0 },
        ],
      });
    });

    test('reports totals, time span and a memory estimate', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 10);
      history.record(msg('a.v1', 's', 1, 100));
      history.record(msg('a.v1', 's', 2, 300));
      const stats = history.getStats();
      expect(stats.count).toBe(2);
      expect(stats.oldestTimestamp).toBe(100);
      expect(stats.newestTimestamp).toBe(300);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('destroy()', () => {
    test('forgets every buffer', () => {
      const history = new MessageHistory();
      history.retain('a.v1', 10);
      history.record(msg('a.v1', 's', 1));
      history.destroy();
      expect(history.getStats()).toEqual({ count: 0, topics: [] });
      expect(history.retains('a.v1')).toBe(false);
    });
  });
});
