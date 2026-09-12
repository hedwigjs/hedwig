import type { ReactNode } from "react";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { formatTimestamp } from "../../../messages/formatTimestamp";
import type { SystemEventLogEntry } from "../../../../../inspector/types";
import styles from "./SystemEventRow.module.css";

interface SystemEventRowProps {
  entry: SystemEventLogEntry;
}

type EventFacet = "client" | "subscription" | "bridge" | "message" | "broker";
type EventVerb = "added" | "removed" | "rejected" | "failed" | "warning";

function facetOf(name: SystemEventLogEntry["name"]): EventFacet {
  if (name.startsWith("client.")) return "client";
  if (name.startsWith("subscription.")) return "subscription";
  if (name.startsWith("message.")) return "message";
  if (name.startsWith("broker.")) return "broker";
  return "bridge";
}

function verbOf(name: SystemEventLogEntry["name"]): EventVerb {
  // client.registered / .unregistered map to added / removed for UI purposes.
  if (name.endsWith("rejected")) return "rejected";
  if (name.endsWith("failed")) return "failed";
  // Realm-singleton diagnostics: nothing broke, but the page is not what
  // the author assumed (library bundled twice / two protocol versions).
  if (name.startsWith("broker.")) return "warning";
  if (name.endsWith("registered") && !name.endsWith("unregistered")) return "added";
  if (name.endsWith("added")) return "added";
  return "removed";
}

function summarize(entry: SystemEventLogEntry): string {
  const p = entry.payload as Record<string, unknown> | null;
  if (!p) return "";
  const clientId = typeof p.clientId === "string" ? p.clientId : undefined;
  const source = typeof p.source === "string" ? p.source : undefined;
  const target = typeof p.target === "string" ? p.target : undefined;
  const topic = typeof p.topic === "string" ? p.topic : undefined;
  const bridgeId = typeof p.bridgeId === "string" ? p.bridgeId : undefined;
  const reason = typeof p.reason === "string" ? p.reason : undefined;
  const messageId = typeof p.messageId === "string" ? p.messageId : undefined;
  const protocolVersion = typeof p.protocolVersion === "number" ? p.protocolVersion : undefined;
  const copies = typeof p.copies === "number" ? p.copies : undefined;
  const otherVersions = Array.isArray(p.otherVersions) ? (p.otherVersions as unknown[]) : undefined;

  // Realm-singleton diagnostics.
  if (protocolVersion !== undefined && copies !== undefined) {
    return `protocol v${protocolVersion} · ${copies} extra ${copies === 1 ? "copy" : "copies"} of @hedwigjs/broker on this page`;
  }
  if (protocolVersion !== undefined && otherVersions) {
    return `protocol v${protocolVersion} · other brokers in this realm: v${otherVersions.join(", v")}`;
  }

  // bridge.send.failed carries topic + messageId; lifecycle events only bridgeId.
  if (bridgeId && topic) return `${bridgeId} · ${topic}${messageId ? ` · ${messageId}` : ""}`;
  if (bridgeId) return bridgeId;
  if (source && target && topic) return `${source} → ${target} · ${topic}${reason ? ` · ${reason}` : ""}`;
  if (clientId && topic) return `${clientId} · ${topic}${reason ? ` · ${reason}` : ""}`;
  if (clientId) return clientId;
  return "";
}

const FACET_CLASS: Record<EventFacet, string> = {
  client: styles.facetClient,
  subscription: styles.facetSubscription,
  bridge: styles.facetBridge,
  message: styles.facetMessage,
  broker: styles.facetBroker,
};

const VERB_CLASS: Record<EventVerb, string> = {
  added: styles.verbAdded,
  removed: styles.verbRemoved,
  rejected: styles.verbRejected,
  failed: styles.verbFailed,
  warning: styles.verbWarning,
};

export function SystemEventRow({ entry }: SystemEventRowProps): ReactNode {
  const facet = facetOf(entry.name);
  const verb = verbOf(entry.name);
  const summary = summarize(entry);

  return (
    <AccordionRow
      rootProps={{ className: styles.row, "data-verb": verb }}
      summary={(open) => (
        <>
          <div className={styles.main}>
            <span className={styles.toggle}>{open ? "−" : "+"}</span>
            <span className={styles.name}>{entry.name}</span>
            <span className={FACET_CLASS[facet]}>{facet}</span>
            <span className={VERB_CLASS[verb]}>{verb}</span>
            <span className={styles.meta}>
              <span className={styles.time}>{formatTimestamp(entry.at)}</span>
            </span>
          </div>
          {summary && <div className={styles.sub}>{summary}</div>}
        </>
      )}
    >
      <pre className={styles.payload}>
        {JSON.stringify(entry.payload, null, 2)}
      </pre>
    </AccordionRow>
  );
}
