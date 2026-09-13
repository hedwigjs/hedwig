import { VERSION, isCompatibleVersion } from "@hedwigjs/broker";
import type { Message, RoutingResult, HistoryEntry } from "@hedwigjs/broker";
import type {
  InspectorSnapshot,
  MessageLogEntry,
  ClientEntry,
  ClientSubscriptionEntry,
  MessagesFilter,
  MessageBrokerForDevTools,
  SystemEventLogEntry,
  SystemEventName,
  VersionStatus,
} from "./types";
import { serializeDataPreview, snapshotFrom, EMPTY_MESSAGES_FILTER } from "./types";
import { createMessageRingBuffer, createRingBuffer } from "./ringLog";
import { matchesAnyPattern } from "./matchPattern";

export interface CreateInspectorStoreOptions {
  maxEvents: number;
}

type ClientBase = Pick<ClientEntry, "id" | "connectedAt" | "remote" | "sdkVersion"> & {
  subscriptions: Array<Pick<ClientSubscriptionEntry, "topic" | "options">>;
};

function computeLastReceivedAt(
  clientId: string,
  topic: string,
  entries: MessageLogEntry[],
): number | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.topic !== topic) continue;
    if (
      e.result?.recipientId === clientId ||
      e.result?.recipientIds?.includes(clientId)
    ) {
      return new Date(e.createdAt).getTime();
    }
  }
  return null;
}

/** Newest local multicast matching a remote's forward pattern. */
function computeLastForwardedAt(pattern: string, entries: MessageLogEntry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.fromExternal || e.target !== "*") continue;
    if (matchesAnyPattern(e.topic, [pattern])) return new Date(e.createdAt).getTime();
  }
  return null;
}

function computeLastActiveAt(
  clientId: string,
  entries: MessageLogEntry[],
): number | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (
      e.source === clientId ||
      e.result?.recipientId === clientId ||
      e.result?.recipientIds?.includes(clientId)
    ) {
      return new Date(e.createdAt).getTime();
    }
  }
  return null;
}

function computeSentCount(clientId: string, entries: MessageLogEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.source === clientId) count++;
  }
  return count;
}

function computeReceivedCount(clientId: string, entries: MessageLogEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.result?.recipientId === clientId || e.result?.recipientIds?.includes(clientId)) {
      count++;
    }
  }
  return count;
}

/**
 * Activity of a remote client is not keyed by its own id: what it injects
 * carries the peer's identity (`tab:cart-store`) with `via === id`, and
 * what it receives is every local multicast matching its `forward`
 * patterns (never listed among recipient ids). Same shape as the local
 * counters so the Clients tab can treat both alike.
 */
function computeRemoteActivity(
  base: ClientBase,
  entries: MessageLogEntry[],
): Pick<ClientEntry, "sentCount" | "receivedCount" | "lastActiveAt"> {
  const forward = base.subscriptions.map((s) => s.topic);
  let sentCount = 0;
  let receivedCount = 0;
  let lastActiveAt: number | null = null;
  for (const e of entries) {
    const sent = e.via === base.id || e.source === base.id;
    const received = !e.fromExternal && matchesAnyPattern(e.topic, forward);
    if (sent) sentCount++;
    if (received) receivedCount++;
    if (sent || received) lastActiveAt = new Date(e.createdAt).getTime();
  }
  return { sentCount, receivedCount, lastActiveAt };
}

export function createInspectorStore(options: CreateInspectorStoreOptions) {
  const { maxEvents } = options;
  const ring = createMessageRingBuffer(maxEvents);
  const systemEventsRing = createRingBuffer<SystemEventLogEntry>(maxEvents);
  let systemEventSeq = 0;
  const pendingStart = new Map<string, number>();
  const listeners = new Set<() => void>();
  let totalSeen = 0;
  let attached = false;
  let version: VersionStatus = {
    expected: VERSION,
    actual: undefined,
    mismatch: false,
  };
  let clientsBase: ClientBase[] = [];
  let messagesFilter: MessagesFilter = { ...EMPTY_MESSAGES_FILTER };
  let historyEntries: ReadonlyArray<HistoryEntry> = [];
  let snapshotCache: InspectorSnapshot = snapshotFrom(
    [],
    totalSeen,
    attached,
    version,
    [],
    messagesFilter,
    [],
    [],
  );

  function emit() {
    const entries = ring.toArray();
    const clients: ClientEntry[] = clientsBase.map((base) => {
      const activity = base.remote
        ? computeRemoteActivity(base, entries)
        : {
            sentCount: computeSentCount(base.id, entries),
            receivedCount: computeReceivedCount(base.id, entries),
            lastActiveAt: computeLastActiveAt(base.id, entries),
          };
      return {
        id: base.id,
        remote: base.remote,
        sdkVersion: base.sdkVersion,
        connectedAt: base.connectedAt,
        ...activity,
        subscriptions: base.subscriptions.map((sub) => ({
          topic: sub.topic,
          options: sub.options,
          lastReceivedAt: base.remote
            ? computeLastForwardedAt(sub.topic, entries)
            : computeLastReceivedAt(base.id, sub.topic, entries),
        })),
      };
    });
    snapshotCache = snapshotFrom(
      entries,
      totalSeen,
      attached,
      version,
      clients,
      messagesFilter,
      historyEntries,
      systemEventsRing.toArray(),
    );
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSnapshot(): InspectorSnapshot {
    return snapshotCache;
  }

  function setAttached(value: boolean) {
    attached = value;
    emit();
  }

  /**
   * Record the attached core's package version. `undefined` (core predates
   * the field) is NOT treated as a mismatch — only a known, incompatible
   * value under the semver rule (same minor before 1.0, same major after).
   */
  function setVersion(actual: string | undefined) {
    version = {
      expected: VERSION,
      actual,
      mismatch: actual !== undefined && !isCompatibleVersion(actual, VERSION),
    };
    emit();
  }

  function clearLog() {
    ring.clear();
    pendingStart.clear();
    totalSeen = 0;
    emit();
  }

  function pushSystemEvent(name: SystemEventName, payload: unknown): void {
    systemEventsRing.push({
      id: `sys-${++systemEventSeq}`,
      at: new Date().toISOString(),
      name,
      payload,
    });
    emit();
  }

  function clearSystemEvents() {
    systemEventsRing.clear();
    emit();
  }

  function setMessagesFilter(patch: Partial<MessagesFilter>) {
    messagesFilter = { ...messagesFilter, ...patch };
    emit();
  }

  function clearMessagesFilter() {
    messagesFilter = { ...EMPTY_MESSAGES_FILTER };
    emit();
  }

  function refreshHistory(broker: MessageBrokerForDevTools) {
    historyEntries = broker.inspect.getHistory();
    emit();
  }

  function refreshClients(broker: MessageBrokerForDevTools) {
    clientsBase = broker.inspect.getClients().map((info) => ({
      id: info.id,
      connectedAt: info.connectedAt,
      sdkVersion: info.sdkVersion,
      remote: info.remote
        ? {
            kind: info.remote.kind,
            identity: info.remote.identity,
            duplex: info.remote.duplex,
            fanout: info.remote.fanout,
            requests: info.remote.requests,
            accepts: info.remote.accepts,
            pending: info.remote.pending,
          }
        : undefined,
      subscriptions: info.subscriptions.map((sub) => ({
        topic: sub.topic,
        options: sub.options,
      })),
    }));
    emit();
  }

  function onBeforeSend(message: Readonly<Message>): void {
    pendingStart.set(message.id, performance.now());
    const entry: MessageLogEntry = {
      id: message.id,
      topic: String(message.topic),
      source: message.source,
      target: message.target,
      createdAt: new Date(message.timestamp).toISOString(),
      status: "pending",
      kind: message.target === "*" ? "multicast" : "unicast",
      replayed: message.replayed,
      fromExternal: message.fromExternal,
      via: message.via,
      wireId: message.wireId,
      ext: message.ext,
      synthetic: message.synthetic,
      dataPreview: serializeDataPreview(message.data),
    };
    ring.push(entry);
    totalSeen += 1;
    emit();
  }

  function onAfterSend(message: Readonly<Message>, result: RoutingResult): void {
    const start = pendingStart.get(message.id);
    pendingStart.delete(message.id);

    const latencyMs = start !== undefined ? Math.round(performance.now() - start) : undefined;
    const physIdx = ring.findIndexById(message.id);
    const success = result.status === "ACK";

    const resultPayload = {
      status: result.status,
      reason: String(result.reason),
      message: result.message,
      recipientId: result.recipientId,
      recipientIds: result.recipientIds,
      responsePreview: result.data !== undefined ? serializeDataPreview(result.data) : undefined,
    };

    const subscriberCount = result.recipientIds?.length;

    if (physIdx >= 0) {
      const prev = ring.getAt(physIdx)!;
      ring.setAt(physIdx, {
        ...prev,
        replayed: message.replayed ?? prev.replayed,
        fromExternal: message.fromExternal ?? prev.fromExternal,
        via: message.via ?? prev.via,
        wireId: message.wireId ?? prev.wireId,
        ext: message.ext ?? prev.ext,
        synthetic: message.synthetic ?? prev.synthetic,
        dataPreview: prev.dataPreview ?? serializeDataPreview(message.data),
        latencyMs,
        subscriberCount,
        status: success ? "delivered" : "failed",
        result: resultPayload,
      });
    } else {
      ring.push({
        id: message.id,
        topic: String(message.topic),
        source: message.source,
        target: message.target,
        createdAt: new Date(message.timestamp).toISOString(),
        status: success ? "delivered" : "failed",
        kind: message.target === "*" ? "multicast" : "unicast",
        subscriberCount,
        replayed: message.replayed,
        fromExternal: message.fromExternal,
        via: message.via,
        wireId: message.wireId,
        ext: message.ext,
        synthetic: message.synthetic,
        dataPreview: serializeDataPreview(message.data),
        latencyMs,
        result: resultPayload,
      });
      totalSeen += 1;
    }
    emit();
  }

  return {
    subscribe,
    getSnapshot,
    setAttached,
    setVersion,
    onBeforeSend,
    onAfterSend,
    clearLog,
    setMessagesFilter,
    clearMessagesFilter,
    refreshClients,
    refreshHistory,
    pushSystemEvent,
    clearSystemEvents,
  };
}

export type MessageInspectorStore = ReturnType<typeof createInspectorStore>;
