import type { Message } from "@hedwigjs/broker";
import type { MessageBrokerForDevTools } from "./types";
import type { MessageInspectorStore } from "./createInspectorStore";

/**
 * Attaches the inspector store to broker hooks + system events.
 *
 * Two channels:
 *  - Extension hooks (useBeforeSendHook / useAfterSendHook) drive the
 *    live user-message feed with pending → delivered/failed transitions.
 *  - `$systemEvents` (client/subscription/bridge lifecycle) drives two
 *    things: the aggregate Clients tab (via `refresh`) and the dedicated
 *    System Events log (via `pushSystemEvent`).
 *
 * @returns Detach function that unsubscribes everything.
 */
export function attachInspector(
  broker: MessageBrokerForDevTools,
  store: MessageInspectorStore,
): () => void {
  store.setAttached(true);

  // Protocol handshake: a panel built against one PROTOCOL_VERSION attached
  // to a core of another would otherwise fail somewhere deep in a renderer.
  store.setProtocol(broker.protocolVersion);

  // Initial snapshots before any hooks/events fire
  store.refreshClients(broker);
  store.refreshHistory(broker);
  store.refreshBridges(broker);

  // Realm-singleton diagnostics happen at app bootstrap, long before this
  // panel mounts, so the live events were never observed. Reconstruct them
  // from the inspect snapshot, same idea as the hydrated `bridge.added`
  // below. Optional chaining: cores that predate `getProtocolInfo`.
  const protocolInfo = broker.inspect.getProtocolInfo?.();
  if (protocolInfo) {
    if (protocolInfo.duplicateCopies > 0) {
      store.pushSystemEvent("broker.duplicate_copy", {
        protocolVersion: protocolInfo.protocolVersion,
        copies: protocolInfo.duplicateCopies,
        hydrated: true,
      });
    }
    if (protocolInfo.otherProtocolVersions.length > 0) {
      store.pushSystemEvent("broker.protocol_mismatch", {
        protocolVersion: protocolInfo.protocolVersion,
        otherVersions: protocolInfo.otherProtocolVersions,
        hydrated: true,
      });
    }
  }

  // Synthesize `bridge.added` for bridges that were registered BEFORE the
  // inspector attached. Otherwise the System Events log would miss any
  // bridge whose registration is synchronous during app bootstrap —
  // DevTools mounts via React useEffect, which is a tick later than sync
  // `addBridge` calls in the shell. Also covers late-attach scenarios
  // (DevTools toggled off then on).
  for (const bridge of broker.inspect.getBridges()) {
    store.pushSystemEvent("bridge.added", {
      bridgeId: bridge.id,
      // Non-standard field: signals the event was reconstructed from a
      // snapshot rather than observed live. Consumers may ignore it.
      hydrated: true,
    });
  }

  const unsubBefore = broker.useBeforeSendHook((message: Readonly<Message>) => {
    store.onBeforeSend(message);
    return { allowed: true };
  });

  const unsubAfter = broker.useAfterSendHook((message, result) => {
    store.onAfterSend(message, result);
    // History buffer may grow after each successfully recorded message
    store.refreshHistory(broker);
  });

  // System events: log every event AND refresh the affected view.
  // Client/subscription events also trigger a client-tree refresh so the
  // Clients tab stays in sync.
  const refreshClients = () => store.refreshClients(broker);

  const unsubClientRegistered = broker.$systemEvents.on("client.registered", (payload) => {
    store.pushSystemEvent("client.registered", payload);
    refreshClients();
  });
  const unsubClientUnregistered = broker.$systemEvents.on("client.unregistered", (payload) => {
    store.pushSystemEvent("client.unregistered", payload);
    refreshClients();
  });
  const unsubSubscriptionAdded = broker.$systemEvents.on("subscription.added", (payload) => {
    store.pushSystemEvent("subscription.added", payload);
    refreshClients();
  });
  const unsubSubscriptionRemoved = broker.$systemEvents.on("subscription.removed", (payload) => {
    store.pushSystemEvent("subscription.removed", payload);
    refreshClients();
  });
  const unsubBridgeAdded = broker.$systemEvents.on("bridge.added", (payload) => {
    store.pushSystemEvent("bridge.added", payload);
    store.refreshBridges(broker);
  });
  const unsubBridgeRemoved = broker.$systemEvents.on("bridge.removed", (payload) => {
    store.pushSystemEvent("bridge.removed", payload);
    store.refreshBridges(broker);
  });
  // Outbound wire failure. The message was delivered locally and the sender
  // got a normal ACK — this event is the only trace that a transport threw
  // on `send()` and the frame never left the page. Log-only: bridge
  // registry is unchanged.
  const unsubBridgeSendFailed = broker.$systemEvents.on("bridge.send.failed", (payload) => {
    store.pushSystemEvent("bridge.send.failed", payload);
  });
  // Live counterparts of the hydrated realm-singleton events above — fire
  // when a lazily loaded remote brings its own copy of the library after
  // the panel is already attached.
  const unsubDuplicateCopy = broker.$systemEvents.on("broker.duplicate_copy", (payload) => {
    store.pushSystemEvent("broker.duplicate_copy", payload);
  });
  const unsubProtocolMismatch = broker.$systemEvents.on("broker.protocol_mismatch", (payload) => {
    store.pushSystemEvent("broker.protocol_mismatch", payload);
  });

  // Security signals — hook-driven rejections. `subscription.rejected` fires
  // when an `onSubscribe` hook denies a subscription (`client.on` throws too,
  // but this event surfaces the denial on the observability channel).
  // `message.rejected` fires when a `beforeSend` hook denies an outgoing
  // message (also visible as NACK HOOK_REJECTED in the delivery log).
  const unsubSubscriptionRejected = broker.$systemEvents.on(
    "subscription.rejected",
    (payload) => {
      store.pushSystemEvent("subscription.rejected", payload);
    },
  );
  const unsubMessageRejected = broker.$systemEvents.on(
    "message.rejected",
    (payload) => {
      store.pushSystemEvent("message.rejected", payload);
    },
  );

  return () => {
    unsubBefore();
    unsubAfter();
    unsubClientRegistered();
    unsubClientUnregistered();
    unsubSubscriptionAdded();
    unsubSubscriptionRemoved();
    unsubBridgeAdded();
    unsubBridgeRemoved();
    unsubBridgeSendFailed();
    unsubDuplicateCopy();
    unsubProtocolMismatch();
    unsubSubscriptionRejected();
    unsubMessageRejected();
    store.setAttached(false);
  };
}
