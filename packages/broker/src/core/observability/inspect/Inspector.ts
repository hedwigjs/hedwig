import type { ClientID, ClientInfo } from '../../types';
import type { ClientRegistry } from '../../client/ClientRegistry';
import type { Subscriptions } from '../../routing/Subscriptions';
import type { Bridge } from '../../bridge/Bridge.types';
import type { MessageHistory } from '../../history/MessageHistory';
import type { HistoryEntry, HistoryStats } from '../../history/MessageHistory.types';
import type { BridgeInfo } from './Inspector.types';

/**
 * Inspector - read-only view over broker state.
 *
 * Exposed via `broker.inspect`. Intended for DevTools, debugging tools, and
 * diagnostic integrations that need point-in-time state snapshots (pull model).
 * Pair with `broker.$systemEvents` (push model) for incremental updates.
 *
 * This class is a pure facade over internal registries — it does NOT own data,
 * it only aggregates and projects it. Dependencies are injected as references,
 * so adding new snapshot methods does not require changing the constructor
 * shape or threading callbacks through `BrokerCore`.
 *
 * All collection-returning methods return `ReadonlyArray<T>` to prevent
 * accidental mutation of broker state by external callers.
 */
export class Inspector<T extends string, P extends Record<T, any>> {
  #clients: ClientRegistry<T, P>;
  #subscriptions: Subscriptions<T>;
  #bridges: ReadonlyMap<string, Bridge>;
  #getHistory: () => MessageHistory<T, P> | undefined;

  constructor(
    clients: ClientRegistry<T, P>,
    subscriptions: Subscriptions<T>,
    bridges: ReadonlyMap<string, Bridge>,
    getHistory: () => MessageHistory<T, P> | undefined,
  ) {
    this.#clients = clients;
    this.#subscriptions = subscriptions;
    this.#bridges = bridges;
    this.#getHistory = getHistory;
  }

  /**
   * Snapshot of every registered client together with its active subscriptions.
   *
   * Use together with `$systemEvents.on('client.*' | 'subscription.*')` to
   * build an accurate initial state without race conditions: read the snapshot
   * first, then subscribe to events for incremental updates.
   */
  getClients(): ReadonlyArray<ClientInfo> {
    return this.#clients.getAllIds().map((id) => ({
      id,
      connectedAt: this.#clients.getConnectedAt(id) ?? Date.now(),
      subscriptions: Array.from(this.#subscriptions.getClientTopics(id) ?? []).map((topic) => ({
        topic,
        // A pair may hold N handlers with different options — the Inspector
        // surface predates the multi-handler model and exposes a single
        // options blob. First handler wins; drill into `getEntries()` for
        // full detail.
        options: this.#subscriptions.getFirstOptions(id, topic as T),
        handlerCount: this.#subscriptions.getHandlerCount(id, topic as T),
      })),
    }));
  }

  /**
   * IDs of clients that have at least one active subscription.
   */
  getSubscribedClientIds(): ReadonlyArray<ClientID> {
    return this.#subscriptions.getAllSubscribedClients();
  }

  /**
   * Lifecycle info for every registered bridge. Does NOT expose internal
   * `Bridge` instances (see `BridgeInfo`).
   */
  getBridges(): ReadonlyArray<BridgeInfo> {
    const result: BridgeInfo[] = [];
    for (const [id, bridge] of this.#bridges) {
      result.push({ id, forwardPatterns: bridge.forwardPatterns });
    }
    return result;
  }

  /**
   * All messages currently stored in the replay buffer (oldest → newest).
   * Returns an empty array when history is not enabled.
   */
  getHistory(): ReadonlyArray<HistoryEntry> {
    const history = this.#getHistory();
    if (!history) return [];
    return history.getSnapshot();
  }

  /**
   * Replay buffer statistics. Always returns `{ enabled: false, count: 0 }`
   * when history is not enabled.
   */
  getHistoryStats(): HistoryStats & { enabled: boolean } {
    const history = this.#getHistory();
    if (!history) return { count: 0, enabled: false };
    return { ...history.getStats(), enabled: true };
  }
}
