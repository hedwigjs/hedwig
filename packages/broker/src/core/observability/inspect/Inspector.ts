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
  #history: MessageHistory<T, P>;
  #getVersionInfo: () => VersionInfo;

  constructor(
    clients: ClientRegistry<T, P>,
    subscriptions: Subscriptions<T>,
    remotes: ReadonlyMap<string, RemoteClientImpl>,
    history: MessageHistory<T, P>,
    getVersionInfo: () => VersionInfo,
  ) {
    this.#clients = clients;
    this.#subscriptions = subscriptions;
    this.#remotes = remotes;
    this.#history = history;
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
   * emitted at least once.
   */
  getRetained(): ReadonlyArray<RetainedState<T, P[T]>> {
    const out: RetainedState<T, P[T]>[] = [];
    for (const info of this.#history.getStats().topics) {
      if (info.kind !== 'state') continue;
      const last = this.#history.last(info.topic);
      if (last) out.push({ topic: last.message.topic, message: last.message, at: last.timestamp });
    }
    return out;
  }

  /**
   * Every retained message across topics (oldest → newest): events with
   * `retention` in their contract and the last value of each `state` topic.
   */
  getHistory(): ReadonlyArray<HistoryEntry> {
    return this.#history.getSnapshot();
  }

  /**
   * Retention as declared by the registry, with each topic's fill, plus
   * whether the host left event retention on (`history.enabled`).
   */
  getHistoryStats(): HistoryStats & { enabled: boolean } {
    return { ...this.#history.getStats(), enabled: this.#history.enabled };
  }
}
