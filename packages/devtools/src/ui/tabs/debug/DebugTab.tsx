import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { RoutingResult } from "@hedwigjs/broker";
import type { MessageInspectorStore } from "../../../inspector/createInspectorStore";
import type { MessageBrokerForDevTools } from "../../../inspector/types";
import { useTopicsRegistry } from "../../topicsRegistry";
import type { TopicContractInfo } from "../../topicsRegistry";
import { TopicPicker } from "./components/TopicPicker/TopicPicker";
import { SourcePicker } from "./components/SourcePicker/SourcePicker";
import { ResultPanel } from "./components/ResultPanel/ResultPanel";
import styles from "./DebugTab.module.css";

export interface DebugTabProps {
  store: MessageInspectorStore;
  broker: MessageBrokerForDevTools;
}

type Mode = "multicast" | "unicast";

const DEFAULT_SOURCE = "devtools";
const BROADCAST_TARGET = "*";

/**
 * Debug tab — hand-craft and send test events into the broker.
 *
 * Delegates to `broker.$debug.send()` under the hood (single broker
 * primitive for both multicast and unicast — target picks the branch).
 * The `source` field is a free string; broker doesn't touch the client
 * registry, so impersonating a real client id is safe.
 *
 * Registry (if passed to <MessageBrokerDevTools />) drives topic
 * autocomplete + example payload prefill. Without a registry the topic
 * field is free-form and payload starts at `{}`.
 */
export function DebugTab({ store, broker }: DebugTabProps): ReactNode {
  const registry = useTopicsRegistry();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const [mode, setMode] = useState<Mode>("multicast");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [recipient, setRecipient] = useState(BROADCAST_TARGET);
  const [payloadText, setPayloadText] = useState("{}");
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RoutingResult | null>(null);
  const [sending, setSending] = useState(false);

  const knownClientIds = useMemo(
    () => snapshot.clients.map((c) => c.id).sort(),
    [snapshot.clients],
  );

  // Impersonation dropdown = registered clients + a plain "devtools" label.
  const sourceOptions = useMemo(() => {
    const set = new Set<string>([DEFAULT_SOURCE, ...knownClientIds]);
    return Array.from(set);
  }, [knownClientIds]);

  const contractRef = useRef<TopicContractInfo | null>(null);

  const handleTopicSelected = useCallback(
    (contract: TopicContractInfo) => {
      contractRef.current = contract;
      setTopic(contract.name);
      const example = contract.examples?.happy ?? Object.values(contract.examples ?? {})[0];
      if (example !== undefined) {
        setPayloadText(JSON.stringify(example, null, 2));
      }
      setPayloadError(null);
    },
    [],
  );

  const handleTopicText = useCallback((text: string) => {
    setTopic(text);
    if (contractRef.current && contractRef.current.name !== text) {
      contractRef.current = null;
    }
  }, []);

  const send = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = payloadText.trim() === "" ? undefined : JSON.parse(payloadText);
    } catch (err) {
      setPayloadError((err as Error).message);
      return;
    }
    setPayloadError(null);

    const target = mode === "multicast" ? BROADCAST_TARGET : recipient;
    if (!topic.trim()) return;

    setSending(true);
    try {
      const result = await broker.$debug.send(
        source || DEFAULT_SOURCE,
        topic.trim(),
        target,
        parsed,
      );
      setLastResult(result);
    } catch (err) {
      // Broker's $debug.send is Promise-based; failures come back as NACK
      // results, not thrown. But guard anyway for unexpected transport
      // errors from custom bridges.
      setLastResult({
        status: "NACK",
        reason: "HANDLER_FAILED",
        message: (err as Error).message,
      } as unknown as RoutingResult);
    } finally {
      setSending(false);
    }
  }, [broker, mode, payloadText, recipient, source, topic]);

  const reset = useCallback(() => {
    setTopic("");
    setSource(DEFAULT_SOURCE);
    setRecipient(BROADCAST_TARGET);
    setPayloadText("{}");
    setPayloadError(null);
    setLastResult(null);
    contractRef.current = null;
  }, []);

  const disabled = sending || !topic.trim();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Send test event</span>
        <span className={styles.headerHint}>
          Delegated to{" "}
          <code className={styles.code}>broker.$debug.send()</code> —
          messages carry <code className={styles.code}>synthetic: true</code>{" "}
          so real traffic stays distinguishable.
        </span>
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className={styles.modeRow}>
          <label className={mode === "multicast" ? styles.modeActive : styles.mode}>
            <input
              type="radio"
              value="multicast"
              checked={mode === "multicast"}
              onChange={() => setMode("multicast")}
            />
            Multicast <span className={styles.modeHint}>emit → *</span>
          </label>
          <label className={mode === "unicast" ? styles.modeActive : styles.mode}>
            <input
              type="radio"
              value="unicast"
              checked={mode === "unicast"}
              onChange={() => setMode("unicast")}
            />
            Unicast <span className={styles.modeHint}>request → client</span>
          </label>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Topic</label>
          <TopicPicker
            value={topic}
            registry={registry}
            onTextChange={handleTopicText}
            onPick={handleTopicSelected}
          />
          {contractRef.current?.description && (
            <div className={styles.description}>
              {contractRef.current.description}
            </div>
          )}
        </div>

        <div className={styles.twoCol}>
          <div className={styles.field}>
            <label className={styles.label}>
              Source{" "}
              <span className={styles.subLabel}>(spoofed identity)</span>
            </label>
            <SourcePicker
              value={source}
              suggestions={sourceOptions}
              onChange={setSource}
              placeholder={DEFAULT_SOURCE}
            />
            <div className={styles.hint}>
              Pick from registered clients or type any label — free string,
              broker won't touch that client's real subscriptions.
            </div>
          </div>

          {mode === "unicast" && (
            <div className={styles.field}>
              <label className={styles.label}>Recipient</label>
              <SourcePicker
                value={recipient === BROADCAST_TARGET ? "" : recipient}
                suggestions={knownClientIds}
                onChange={(v) => setRecipient(v || BROADCAST_TARGET)}
                placeholder="Client id"
              />
              <div className={styles.hint}>
                Pick from registered clients or type any id. A recipient that
                has no handler for the topic (including non-registered ids)
                returns{" "}
                <code className={styles.code}>NACK NOT_SUBSCRIBED</code>.
                Handler's return value is captured in{" "}
                <code className={styles.code}>result.data</code>.
              </div>
            </div>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Payload (JSON)</label>
          <textarea
            className={styles.textarea}
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value);
              if (payloadError) setPayloadError(null);
            }}
            rows={10}
            spellCheck={false}
            placeholder='{"key": "value"}'
          />
          {payloadError && (
            <div className={styles.error}>Invalid JSON: {payloadError}</div>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={disabled}
          >
            {sending ? "Sending…" : mode === "multicast" ? "Emit" : "Request"}
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={reset}
            disabled={sending}
          >
            Reset
          </button>
        </div>

        {lastResult && <ResultPanel result={lastResult} mode={mode} />}
      </form>
    </div>
  );
}
