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
  BridgeEntry,
} from "./types";
import { serializeDataPreview, snapshotFrom, EMPTY_MESSAGES_FILTER } from "./types";
import { createMessageRingBuffer, createRingBuffer } from "./ringLog";
import { matchesAnyPattern } from "./matchPattern";

export interface CreateInspectorStoreOptions {
  maxEvents: number;
}

type ClientBase = Pick<ClientEntry, "id" | "connectedAt"> & {
  subscriptions: Array<Pick<ClientSubscriptionEntry, "topic" | "options">>;
};

type BridgeBase = Pick<BridgeEntry, "id" | "forwardPatterns" | "transportKind">;

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

export function createInspectorStore(options: CreateInspectorStoreOptions) {
  const { maxEvents } = options;
  const ring = createMessageRingBuffer(maxEvents);
  const systemEventsRing = createRingBuffer<SystemEventLogEntry>(maxEvents);
  let systemEventSeq = 0;
  const pendingStart = new Map<string, number>();
  const listeners = new Set<() => void>();
  let totalSeen = 0;
  let attached = false;
  let clientsBase: ClientBase[] = [];
  let messagesFilter: MessagesFilter = { ...EMPTY_MESSAGES_FILTER };
  let historyEntries: ReadonlyArray<HistoryEntry> = [];
  let bridgesBase: BridgeBase[] = [];
  let snapshotCache: InspectorSnapshot = snapshotFrom(
    [],
    totalSeen,
    attached,
    [],
    messagesFilter,
    [],
    [],
    [],
  );

  function emit() {
    const entries = ring.toArray();
    const clients: ClientEntry[] = clientsBase.map((base) => ({
      id: base.id,
      sentCount: computeSentCount(base.id, entries),
      receivedCount: computeReceivedCount(base.id, entries),
      connectedAt: base.connectedAt,
      lastActiveAt: computeLastActiveAt(base.id, entries),
      subscriptions: base.subscriptions.map((sub) => ({
        topic: sub.topic,
        options: sub.options,
        lastReceivedAt: computeLastReceivedAt(base.id, sub.topic, entries),
      })),
    }));
    const bridges: BridgeEntry[] = bridgesBase.map((base) => {
      let sentThroughCount = 0;
      let receivedFromCount = 0;
      for (const e of entries) {
        if (!matchesAnyPattern(e.topic, base.forwardPatterns)) continue;
        if (e.fromExternal) receivedFromCount++;
        else sentThroughCount++;
      }
      return {
        id: base.id,
        forwardPatterns: base.forwardPatterns,
        transportKind: base.transportKind,
        sentThroughCount,
        receivedFromCount,
      };
    });

    snapshotCache = snapshotFrom(
      entries,
      totalSeen,
      attached,
      clients,
      messagesFilter,
      historyEntries,
      systemEventsRing.toArray(),
      bridges,
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
      subscriptions: info.subscriptions.map((sub) => ({
        topic: sub.topic,
        options: sub.options,
      })),
    }));
    emit();
  }

  function refreshBridges(broker: MessageBrokerForDevTools) {
    bridgesBase = broker.inspect.getBridges().map((info) => ({
      id: info.id,
      forwardPatterns: info.forwardPatterns,
      transportKind: info.transportKind,
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
    onBeforeSend,
    onAfterSend,
    clearLog,
    setMessagesFilter,
    clearMessagesFilter,
    refreshClients,
    refreshHistory,
    refreshBridges,
    pushSystemEvent,
    clearSystemEvents,
  };
}

export type MessageInspectorStore = ReturnType<typeof createInspectorStore>;
