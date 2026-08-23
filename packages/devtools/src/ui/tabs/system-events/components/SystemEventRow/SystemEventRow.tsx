import type { ReactNode } from "react";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { formatTimestamp } from "../../../messages/formatTimestamp";
import type { SystemEventLogEntry } from "../../../../../inspector/types";
import styles from "./SystemEventRow.module.css";

interface SystemEventRowProps {
  entry: SystemEventLogEntry;
}

type EventFacet = "client" | "subscription" | "bridge";
type EventVerb = "added" | "removed";

function facetOf(name: SystemEventLogEntry["name"]): EventFacet {
  if (name.startsWith("client.")) return "client";
  if (name.startsWith("subscription.")) return "subscription";
  return "bridge";
}

function verbOf(name: SystemEventLogEntry["name"]): EventVerb {
  // client.registered / .unregistered map to added / removed for UI purposes.
  if (name.endsWith("registered") && !name.endsWith("unregistered")) return "added";
  if (name.endsWith("added")) return "added";
  return "removed";
}

function summarize(entry: SystemEventLogEntry): string {
  const p = entry.payload as Record<string, unknown> | null;
  if (!p) return "";
  const clientId = typeof p.clientId === "string" ? p.clientId : undefined;
  const topic = typeof p.topic === "string" ? p.topic : undefined;
  const bridgeId = typeof p.bridgeId === "string" ? p.bridgeId : undefined;

  if (bridgeId) return bridgeId;
  if (clientId && topic) return `${clientId} · ${topic}`;
  if (clientId) return clientId;
  return "";
}

const FACET_CLASS: Record<EventFacet, string> = {
  client: styles.facetClient,
  subscription: styles.facetSubscription,
  bridge: styles.facetBridge,
};

const VERB_CLASS: Record<EventVerb, string> = {
  added: styles.verbAdded,
  removed: styles.verbRemoved,
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
