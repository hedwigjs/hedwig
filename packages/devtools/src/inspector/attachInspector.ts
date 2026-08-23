import type { Message } from "@hedwigjs/broker";
import type { MessageBrokerForDevTools } from "./types";
import type { MessageInspectorStore } from "./createInspectorStore";

/**
 * Attaches the inspector store to broker hooks + system events.
 *
 * Extension hooks (useBeforeSendHook / useAfterSendHook) are used for the live
 * message feed. System events (`client.*`, `subscription.*`) keep the client
 * tree in sync — they live on the broker-internal `$systemEvents` channel.
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

  const unsubBefore = broker.useBeforeSendHook((message: Readonly<Message>) => {
    store.onBeforeSend(message);
    return { allowed: true };
  });

  const unsubAfter = broker.useAfterSendHook((message, result) => {
    store.onAfterSend(message, result);
    // History buffer may grow after each successfully recorded message
    store.refreshHistory(broker);
  });

  // Subscribe to all client/subscription lifecycle events. Each event
  // triggers a full client snapshot refresh — granular diffs can come later
  // when DevTools needs per-event UX (e.g. "just-connected" highlights).
  const refresh = () => store.refreshClients(broker);
  const unsubClientRegistered = broker.$systemEvents.on("client.registered", refresh);
  const unsubClientUnregistered = broker.$systemEvents.on("client.unregistered", refresh);
  const unsubSubscriptionAdded = broker.$systemEvents.on("subscription.added", refresh);
  const unsubSubscriptionRemoved = broker.$systemEvents.on("subscription.removed", refresh);

  return () => {
    unsubBefore();
    unsubAfter();
    unsubClientRegistered();
    unsubClientUnregistered();
    unsubSubscriptionAdded();
    unsubSubscriptionRemoved();
    store.setAttached(false);
  };
}
