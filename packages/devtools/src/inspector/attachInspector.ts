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

  // Initial snapshots before any hooks/events fire
  store.refreshClients(broker);
  store.refreshHistory(broker);
  store.refreshBridges(broker);

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
    unsubSubscriptionRejected();
    unsubMessageRejected();
    store.setAttached(false);
  };
}
