// AUTO-GENERATED. DO NOT EDIT.
// Run `npm run build` to regenerate.

import CartCheckoutRequestedV1 from "./domains/cart/checkout-requested.v1";
import CartItemAddedV1 from "./domains/cart/item-added.v1";
import CartItemDecrementedV1 from "./domains/cart/item-decremented.v1";
import CartItemIncrementedV1 from "./domains/cart/item-incremented.v1";
import CartItemRemovedV1 from "./domains/cart/item-removed.v1";
import CartSnapshotV1 from "./domains/cart/snapshot.v1";
import ChatMessageSentV1 from "./domains/chat/message-sent.v1";
import ChatReplyCancelledV1 from "./domains/chat/reply-cancelled.v1";
import ChatReplyChunkV1 from "./domains/chat/reply-chunk.v1";
import ChatReplyCompletedV1 from "./domains/chat/reply-completed.v1";
import ChatReplyStartedV1 from "./domains/chat/reply-started.v1";
import CheckoutCancelledV1 from "./domains/checkout/cancelled.v1";
import CheckoutCompletedV1 from "./domains/checkout/completed.v1";
import NotificationShowV1 from "./domains/notification/show.v1";
import UiMenuItemClosedV1 from "./domains/ui/menu-item-closed.v1";
import UiMenuItemOpenedV1 from "./domains/ui/menu-item-opened.v1";

export const registry = {
  "cart.checkout-requested.v1": CartCheckoutRequestedV1,
  "cart.item-added.v1": CartItemAddedV1,
  "cart.item-decremented.v1": CartItemDecrementedV1,
  "cart.item-incremented.v1": CartItemIncrementedV1,
  "cart.item-removed.v1": CartItemRemovedV1,
  "cart.snapshot.v1": CartSnapshotV1,
  "chat.message-sent.v1": ChatMessageSentV1,
  "chat.reply-cancelled.v1": ChatReplyCancelledV1,
  "chat.reply-chunk.v1": ChatReplyChunkV1,
  "chat.reply-completed.v1": ChatReplyCompletedV1,
  "chat.reply-started.v1": ChatReplyStartedV1,
  "checkout.cancelled.v1": CheckoutCancelledV1,
  "checkout.completed.v1": CheckoutCompletedV1,
  "notification.show.v1": NotificationShowV1,
  "ui.menu-item-closed.v1": UiMenuItemClosedV1,
  "ui.menu-item-opened.v1": UiMenuItemOpenedV1,
} as const;

export type Topic = keyof typeof registry;

export type TopicPayloads = {
  [K in Topic]: (typeof registry)[K] extends { payload: infer P } ? P : never;
};

export const TOPICS = {
  CART_CHECKOUT_REQUESTED_V1: "cart.checkout-requested.v1",
  CART_ITEM_ADDED_V1: "cart.item-added.v1",
  CART_ITEM_DECREMENTED_V1: "cart.item-decremented.v1",
  CART_ITEM_INCREMENTED_V1: "cart.item-incremented.v1",
  CART_ITEM_REMOVED_V1: "cart.item-removed.v1",
  CART_SNAPSHOT_V1: "cart.snapshot.v1",
  CHAT_MESSAGE_SENT_V1: "chat.message-sent.v1",
  CHAT_REPLY_CANCELLED_V1: "chat.reply-cancelled.v1",
  CHAT_REPLY_CHUNK_V1: "chat.reply-chunk.v1",
  CHAT_REPLY_COMPLETED_V1: "chat.reply-completed.v1",
  CHAT_REPLY_STARTED_V1: "chat.reply-started.v1",
  CHECKOUT_CANCELLED_V1: "checkout.cancelled.v1",
  CHECKOUT_COMPLETED_V1: "checkout.completed.v1",
  NOTIFICATION_SHOW_V1: "notification.show.v1",
  UI_MENU_ITEM_CLOSED_V1: "ui.menu-item-closed.v1",
  UI_MENU_ITEM_OPENED_V1: "ui.menu-item-opened.v1",
} as const;
