import type {
  Message,
  RoutingResult,
  SubscriptionOptions,
  HistoryEntry,
  SystemEventsEmitter,
  Inspector,
} from "@hedwigjs/broker";

/**
 * Minimal broker contract for devtools subscription.
 * Matches BrokerCore surface accessible without exporting the class.
 *
 * - `useBeforeSendHook` / `useAfterSendHook`: extension hooks the inspector uses
 *   to record the live message feed (topic, result, latency).
 * - `$systemEvents`: broker-internal push channel of lifecycle events
 *   (client.*, subscription.*, bridge.*) — keeps the client tree in sync.
 *   The `$` prefix signals this is a tooling-only API.
 * - `inspect`: pull API for point-in-time state snapshots (clients, history,
 *   bridges). Used for initial hydration without races.
 */
export interface MessageBrokerForDevTools {
  useBeforeSendHook(hook: (message: Readonly<Message>) => { allowed: true } | { allowed: false; message: string }): () => void;
  useAfterSendHook(hook: (message: Readonly<Message>, result: RoutingResult) => void): () => void;
  $systemEvents: SystemEventsEmitter<string, Record<string, any>>;
  inspect: Inspector<string, Record<string, any>>;
}

export type { HistoryEntry };

export type LogStatus = "pending" | "delivered" | "failed";

/** multicast = broadcast to '*' (emit); unicast = targeted to a specific client (request). */
export type MessageKind = "multicast" | "unicast";

export interface MessageLogEntry {
  id: string;
  topic: string;
  source: string;
  target: string;
  /** ISO timestamp */
  createdAt: string;
  status: LogStatus;
  kind: MessageKind;
  /** Number of subscribers that received this emit (undefined for unicast). */
  subscriberCount?: number;
  replayed?: boolean;
  fromExternal?: boolean;
  dataPreview?: string;
  latencyMs?: number;
  result?: {
    status: "ACK" | "NACK";
    reason: string;
    message: string;
    /** Recipient client ID — unicast only. */
    recipientId?: string;
    /** All recipient client IDs — multicast only. */
    recipientIds?: string[];
    /** Serialized return value from the handler (request-reply only). */
    responsePreview?: string;
  };
}

// ─── Messages filter ────────────────────────────────────────────────────────

export interface MessagesFilter {
  /** Text search on topic name. */
  topic: string;
  /** Filter by client ID (matches source or any recipient). */
  clientId?: string;
  /**
   * Narrows clientId filter to sent or received messages only.
   * Ignored when clientId is not set.
   */
  direction?: "sent" | "received";
  kind?: MessageKind;
  /** Filter by delivery result. "pending" = still in flight. */
  result?: "ACK" | "NACK" | "pending";
}

export const EMPTY_MESSAGES_FILTER: MessagesFilter = { topic: "" };

// ─── Messages rollup ────────────────────────────────────────────────────────

/**
 * Configuration for collapsing high-frequency same-topic bursts (e.g. SSE
 * chunk streams) into a single expandable row so a flood of events from
 * one source doesn't drown out everything else in the log.
 *
 * A group is formed when consecutive entries share the same `(topic, source)`
 * and each pair is within `windowMs`. Groups with < `minCount` entries stay
 * flattened as individual rows — the rollup only kicks in for real bursts.
 */
export interface MessagesRollupConfig {
  /** Minimum consecutive matching entries to fold into a stream row. */
  minCount: number;
  /** Max gap (ms) between adjacent entries to still consider them one stream. */
  windowMs: number;
}

export const DEFAULT_MESSAGES_ROLLUP: MessagesRollupConfig = {
  minCount: 5,
  windowMs: 1000,
};

// ─── Client snapshot ─────────────────────────────────────────────────────────

export interface ClientSubscriptionEntry {
  topic: string;
  options?: SubscriptionOptions;
  /** Unix ms of the last message received on this subscription. Null if never. */
  lastReceivedAt: number | null;
}

export interface ClientEntry {
  id: string;
  connectedAt: number;
  /** Unix ms of the last message sent or received by this client. Null if none. */
  lastActiveAt: number | null;
  /** Messages sent by this client visible in the current ring buffer. */
  sentCount: number;
  /** Messages received by this client visible in the current ring buffer. */
  receivedCount: number;
  subscriptions: ClientSubscriptionEntry[];
}

// ─── Inspector snapshot ───────────────────────────────────────────────────────

export interface InspectorSnapshot {
  /** Oldest → newest order. Reverse before rendering in the log. */
  entries: ReadonlyArray<MessageLogEntry>;
  totalSeen: number;
  attached: boolean;
  clients: ReadonlyArray<ClientEntry>;
  messagesFilter: MessagesFilter;
  /** Current contents of the broker's replay buffer (oldest → newest). */
  historyEntries: ReadonlyArray<HistoryEntry>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeDataPreview(data: unknown, maxLen = 800): string {
  try {
    const s = JSON.stringify(data, null, 0);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + "…";
  } catch {
    return String(data);
  }
}

function snapshotFrom(
  list: MessageLogEntry[],
  totalSeen: number,
  attached: boolean,
  clients: ClientEntry[],
  messagesFilter: MessagesFilter,
  historyEntries: ReadonlyArray<HistoryEntry>,
): InspectorSnapshot {
  return { entries: list, totalSeen, attached, clients, messagesFilter, historyEntries };
}

export { serializeDataPreview, snapshotFrom };
