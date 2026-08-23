import type { TopicPayloads } from '@hedwig-demo/contracts';

type Handler<K extends keyof TopicPayloads> = (payload: TopicPayloads[K]) => void;
type ListenerMap = Map<keyof TopicPayloads, Set<Handler<any>>>;
type LastValueMap = Map<keyof TopicPayloads, unknown>;

/**
 * Cross-MFE singleton store.
 *
 * Under Module Federation each MFE bundles its own copy of this package,
 * so a plain module-scope `Map` would give every MFE a private listener
 * registry. Parking the store on `window` gives a single shared instance
 * per browser realm — same shape @hedwigjs/broker.initBroker() will produce.
 */
const GLOBAL_KEY = '__HEDWIG_MOCK_BUS__' as const;

type GlobalHost = typeof globalThis & {
  [GLOBAL_KEY]?: { listeners: ListenerMap; lastValue: LastValueMap };
};

function getStore() {
  const host = globalThis as GlobalHost;
  if (!host[GLOBAL_KEY]) {
    host[GLOBAL_KEY] = { listeners: new Map(), lastValue: new Map() };
  }
  return host[GLOBAL_KEY]!;
}

function log(topic: keyof TopicPayloads, payload: unknown) {
  const style = 'color:#0f766e;font-weight:600';
  // eslint-disable-next-line no-console
  console.log(`%c[mock-bus] ${String(topic)}`, style, payload);
}

export type SubscribeOptions = {
  /**
   * If true and the topic has a cached last payload, fire the handler
   * synchronously with it right after subscribing. Mirrors
   * `client.on(topic, h, { history: true })` from @hedwigjs/broker.
   */
  replay?: boolean;
};

export const mockBus = {
  emit<K extends keyof TopicPayloads>(topic: K, payload: TopicPayloads[K]): void {
    log(topic, payload);
    const store = getStore();
    store.lastValue.set(topic, payload);
    store.listeners.get(topic)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[mock-bus] handler for ${String(topic)} threw`, err);
      }
    });
  },

  on<K extends keyof TopicPayloads>(
    topic: K,
    handler: Handler<K>,
    opts?: SubscribeOptions,
  ): () => void {
    const store = getStore();
    let set = store.listeners.get(topic);
    if (!set) {
      set = new Set();
      store.listeners.set(topic, set);
    }
    set.add(handler);

    if (opts?.replay && store.lastValue.has(topic)) {
      try {
        handler(store.lastValue.get(topic) as TopicPayloads[K]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[mock-bus] replay handler for ${String(topic)} threw`, err);
      }
    }

    return () => {
      set!.delete(handler);
    };
  },

  off<K extends keyof TopicPayloads>(topic: K, handler: Handler<K>): void {
    getStore().listeners.get(topic)?.delete(handler);
  },
};
