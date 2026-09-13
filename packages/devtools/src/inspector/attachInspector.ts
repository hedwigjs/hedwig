import type { Message } from "@hedwigjs/broker";
import type { MessageBrokerForDevTools } from "./types";
import type { MessageInspectorStore } from "./createInspectorStore";

/**
 * Attaches the inspector store to broker hooks + system events.
 *
 * Two channels:
 *  - Extension hooks (useBeforeSendHook / useAfterSendHook) drive the
 *    live user-message feed with pending → delivered/failed transitions.
 *  - `$systemEvents` (client/subscription/remote-client lifecycle) drives two
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

  // Version handshake: a panel built against one @hedwigjs/broker version
  // attached to an incompatible core would otherwise fail somewhere deep in
  // a renderer.
  store.setVersion(broker.version);

  // Initial snapshots before any hooks/events fire
  store.refreshClients(broker);
  store.refreshHistory(broker);

  // Realm-singleton diagnostics happen at app bootstrap, long before this
  // panel mounts, so the live event was never observed. Reconstruct it from
  // the inspect snapshot; remote clients registered before attach are
  // covered by `refreshClients` above.
  // Optional chaining: cores that predate `getVersionInfo`.
  const versionInfo = broker.inspect.getVersionInfo?.();
  if (versionInfo && versionInfo.duplicateCopies > 0) {
    store.pushSystemEvent("broker.duplicate_copy", {
      version: versionInfo.version,
      copies: versionInfo.duplicateCopies,
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
  // Remote clients (`broker.createRemoteClient`). Lifecycle is mirrored by
  // `client.registered` / `client.unregistered`, which already refresh the
  // Clients tab; these entries are log-only. `remote.frame.rejected` is an
  // inbound frame dropped at the edge before any hook (no Messages row);
  // `remote.send.failed` is an outbound frame the transport could not carry.
  const unsubRemoteCreated = broker.$systemEvents.on("remote.created", (payload) => {
    store.pushSystemEvent("remote.created", payload);
  });
  const unsubRemoteDestroyed = broker.$systemEvents.on("remote.destroyed", (payload) => {
    store.pushSystemEvent("remote.destroyed", payload);
  });
  const unsubRemoteFrameRejected = broker.$systemEvents.on("remote.frame.rejected", (payload) => {
    store.pushSystemEvent("remote.frame.rejected", payload);
  });
  const unsubRemoteSendFailed = broker.$systemEvents.on("remote.send.failed", (payload) => {
    store.pushSystemEvent("remote.send.failed", payload);
  });
  // Requests over a wire. The message row already carries the final result
  // and latency; these four are the wire-level trace (frame left, response
  // matched, local timeout, inbound request answered).
  const unsubRequestForwarded = broker.$systemEvents.on("request.forwarded", (payload) => {
    store.pushSystemEvent("request.forwarded", payload);
  });
  const unsubResponseReceived = broker.$systemEvents.on("response.received", (payload) => {
    store.pushSystemEvent("response.received", payload);
  });
  const unsubRequestTimeout = broker.$systemEvents.on("request.timeout", (payload) => {
    store.pushSystemEvent("request.timeout", payload);
  });
  const unsubResponseSent = broker.$systemEvents.on("response.sent", (payload) => {
    store.pushSystemEvent("response.sent", payload);
  });
  // A state topic's retained value was replaced.
  const unsubStateRetained = broker.$systemEvents.on("state.retained", (payload) => {
    store.pushSystemEvent("state.retained", payload);
  });
  // Live counterpart of the hydrated realm-singleton event above — fires
  // when a lazily loaded remote brings its own copy of the library after
  // the panel is already attached.
  const unsubDuplicateCopy = broker.$systemEvents.on("broker.duplicate_copy", (payload) => {
    store.pushSystemEvent("broker.duplicate_copy", payload);
  });
  // A hook threw. With the default fail-closed mode a guard hook's failure
  // is also a denial (the message shows as NACK HOOK_REJECTED); this event
  // tells you it was a crash, not a policy decision.
  const unsubHookFailed = broker.$systemEvents.on("hook.failed", (payload) => {
    store.pushSystemEvent("hook.failed", payload);
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
    unsubRemoteCreated();
    unsubRemoteDestroyed();
    unsubRemoteFrameRejected();
    unsubRemoteSendFailed();
    unsubRequestForwarded();
    unsubResponseReceived();
    unsubRequestTimeout();
    unsubResponseSent();
    unsubStateRetained();
    unsubDuplicateCopy();
    unsubHookFailed();
    unsubSubscriptionRejected();
    unsubMessageRejected();
    store.setAttached(false);
  };
}
