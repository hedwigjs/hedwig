import type { ClientID, ClientInfo, RetainedState } from '../../types';
import type { ClientRegistry } from '../../client/ClientRegistry';
import type { Subscriptions } from '../../routing/Subscriptions';
import type { RemoteClientImpl } from '../../remote/RemoteClient';
import type { MessageHistory } from '../../history/MessageHistory';
import type { HistoryEntry, HistoryStats } from '../../history/MessageHistory.types';
import type { VersionInfo } from './Inspector.types';

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
  #remotes: ReadonlyMap<string, RemoteClientImpl>;
  #retained: ReadonlyMap<string, RetainedState<T, P[T]>>;
  #getHistory: () => MessageHistory<T, P> | undefined;
  #getVersionInfo: () => VersionInfo;

  constructor(
    clients: ClientRegistry<T, P>,
    subscriptions: Subscriptions<T>,
    remotes: ReadonlyMap<string, RemoteClientImpl>,
    retained: ReadonlyMap<string, RetainedState<T, P[T]>>,
    getHistory: () => MessageHistory<T, P> | undefined,
    getVersionInfo: () => VersionInfo,
  ) {
    this.#clients = clients;
    this.#subscriptions = subscriptions;
    this.#remotes = remotes;
    this.#retained = retained;
    this.#getHistory = getHistory;
    this.#getVersionInfo = getVersionInfo;
  }

  /**
   * Realm-singleton diagnostics: this core's package version and how many
   * other copies of the library adopted it. See {@link VersionInfo}.
   */
  getVersionInfo(): VersionInfo {
    return this.#getVersionInfo();
  }

  /**
   * Snapshot of every registered client together with its active subscriptions.
   *
   * Use together with `$systemEvents.on('client.*' | 'subscription.*')` to
   * build an accurate initial state without race conditions: read the snapshot
   * first, then subscribe to events for incremental updates.
   */
  getClients(): ReadonlyArray<ClientInfo> {
    const local: ClientInfo[] = this.#clients.getAllIds().map((id) => ({
      id,
      connectedAt: this.#clients.getConnectedAt(id) ?? Date.now(),
      sdkVersion: this.#clients.get(id)?.meta?.sdkVersion,
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
    const remote: ClientInfo[] = Array.from(this.#remotes.values()).map((r) => ({
      id: r.id,
      connectedAt: r.createdAt,
      subscriptions: r.forwardPatterns.map((topic) => ({ topic, handlerCount: 0 })),
      remote: {
        kind: r.kind,
        identity: r.identity,
        duplex: r.duplex,
        fanout: r.fanout,
        requests: r.requests,
        accepts: [...r.acceptPatterns],
        pending: r.pending,
      },
    }));
    return [...local, ...remote];
  }

  /**
   * IDs of clients that have at least one active subscription.
   */
  getSubscribedClientIds(): ReadonlyArray<ClientID> {
    return this.#subscriptions.getAllSubscribedClients();
  }

  /**
   * The retained (last) value of every `state` topic that has been
   * emitted at least once. Independent of the history buffer.
   */
  getRetained(): ReadonlyArray<RetainedState<T, P[T]>> {
    return Array.from(this.#retained.values());
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
