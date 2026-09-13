// AUTO-GENERATED. DO NOT EDIT.
// Run `npm run build` to regenerate.

import type { TopicKind } from "./lib/contract";

import CartAddItemV1 from "./domains/cart/add-item.v1";
import CartDecrementV1 from "./domains/cart/decrement.v1";
import CartRemoveItemV1 from "./domains/cart/remove-item.v1";
import CartSnapshotV1 from "./domains/cart/snapshot.v1";
import ChatMessageSentV1 from "./domains/chat/message-sent.v1";
import ChatReplyCancelledV1 from "./domains/chat/reply-cancelled.v1";
import ChatReplyChunkV1 from "./domains/chat/reply-chunk.v1";
import ChatReplyCompletedV1 from "./domains/chat/reply-completed.v1";
import ChatReplyStartedV1 from "./domains/chat/reply-started.v1";
import CheckoutCancelledV1 from "./domains/checkout/cancelled.v1";
import CheckoutCompletedV1 from "./domains/checkout/completed.v1";
import CheckoutStartV1 from "./domains/checkout/start.v1";
import NotificationShowV1 from "./domains/notification/show.v1";
import NotificationStatusV1 from "./domains/notification/status.v1";
import UiMenuItemClosedV1 from "./domains/ui/menu-item-closed.v1";
import UiMenuItemOpenedV1 from "./domains/ui/menu-item-opened.v1";

export const registry = {
  "cart.add-item.v1": CartAddItemV1,
  "cart.decrement.v1": CartDecrementV1,
  "cart.remove-item.v1": CartRemoveItemV1,
  "cart.snapshot.v1": CartSnapshotV1,
  "chat.message-sent.v1": ChatMessageSentV1,
  "chat.reply-cancelled.v1": ChatReplyCancelledV1,
  "chat.reply-chunk.v1": ChatReplyChunkV1,
  "chat.reply-completed.v1": ChatReplyCompletedV1,
  "chat.reply-started.v1": ChatReplyStartedV1,
  "checkout.cancelled.v1": CheckoutCancelledV1,
  "checkout.completed.v1": CheckoutCompletedV1,
  "checkout.start.v1": CheckoutStartV1,
  "notification.show.v1": NotificationShowV1,
  "notification.status.v1": NotificationStatusV1,
  "ui.menu-item-closed.v1": UiMenuItemClosedV1,
  "ui.menu-item-opened.v1": UiMenuItemOpenedV1,
} as const;

export type Topic = keyof typeof registry;

export type TopicPayloads = {
  [K in Topic]: (typeof registry)[K] extends { payload: infer P } ? P : never;
};

/** Род каждого топика; контракт без `kind` — событие. */
export type TopicKinds = {
  [K in Topic]: (typeof registry)[K] extends { kind: infer Kd extends TopicKind } ? Kd : "event";
};

export type EventTopic = { [K in Topic]: TopicKinds[K] extends "event" ? K : never }[Topic];
export type RequestTopic = { [K in Topic]: TopicKinds[K] extends "request" ? K : never }[Topic];
export type StateTopic = { [K in Topic]: TopicKinds[K] extends "state" ? K : never }[Topic];

/** Тип ответа каждого запроса — из поля `response` контракта. */
export type TopicResponses = {
  [K in RequestTopic]: (typeof registry)[K] extends { response: infer R } ? R : unknown;
};

/**
 * Род и тип ответа в одной карте — третий параметр
 * `createClient<Topic, TopicPayloads, TopicContracts>()`: `emit` принимает
 * только события и состояние, `request` только запросы, и выводит ответ.
 */
export type TopicContracts = {
  [K in Topic]: {
    kind: TopicKinds[K];
    response: K extends RequestTopic ? TopicResponses[K] : never;
  };
};

export const TOPICS = {
  CART_ADD_ITEM_V1: "cart.add-item.v1",
  CART_DECREMENT_V1: "cart.decrement.v1",
  CART_REMOVE_ITEM_V1: "cart.remove-item.v1",
  CART_SNAPSHOT_V1: "cart.snapshot.v1",
  CHAT_MESSAGE_SENT_V1: "chat.message-sent.v1",
  CHAT_REPLY_CANCELLED_V1: "chat.reply-cancelled.v1",
  CHAT_REPLY_CHUNK_V1: "chat.reply-chunk.v1",
  CHAT_REPLY_COMPLETED_V1: "chat.reply-completed.v1",
  CHAT_REPLY_STARTED_V1: "chat.reply-started.v1",
  CHECKOUT_CANCELLED_V1: "checkout.cancelled.v1",
  CHECKOUT_COMPLETED_V1: "checkout.completed.v1",
  CHECKOUT_START_V1: "checkout.start.v1",
  NOTIFICATION_SHOW_V1: "notification.show.v1",
  NOTIFICATION_STATUS_V1: "notification.status.v1",
  UI_MENU_ITEM_CLOSED_V1: "ui.menu-item-closed.v1",
  UI_MENU_ITEM_OPENED_V1: "ui.menu-item-opened.v1",
} as const;

/** Роды топиков для рантайма: `initBroker({ topics: TOPIC_KINDS })`. */
export const TOPIC_KINDS = {
  "cart.add-item.v1": "request",
  "cart.decrement.v1": "request",
  "cart.remove-item.v1": "request",
  "cart.snapshot.v1": "state",
  "chat.message-sent.v1": "event",
  "chat.reply-cancelled.v1": "event",
  "chat.reply-chunk.v1": "event",
  "chat.reply-completed.v1": "event",
  "chat.reply-started.v1": "event",
  "checkout.cancelled.v1": "event",
  "checkout.completed.v1": "event",
  "checkout.start.v1": "request",
  "notification.show.v1": "event",
  "notification.status.v1": "request",
  "ui.menu-item-closed.v1": "event",
  "ui.menu-item-opened.v1": "event",
} as const satisfies Record<Topic, TopicKind>;
