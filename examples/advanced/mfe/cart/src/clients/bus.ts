import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/**
 * Cart MFE speaks the shared bus with two identities:
 *
 * - `runtimeBus` — the SoT. Subscribes to `cart.item-*` commands and emits
 *   `cart.snapshot.v1`. Kept separate so runtime is excluded from its own
 *   snapshot emissions and CAN hear commands emitted by the UI side
 *   (broker excludes sender from its own multicast).
 *
 * - `uiBus` — everything user-facing: Panel, HeaderTrigger, Popup all
 *   subscribe to `cart.snapshot.v1` through this one client, and actions
 *   emit `cart.item-*` through it too. Since the broker now accepts N
 *   handlers per (client, topic), the views no longer need distinct
 *   client identities.
 */
export const runtimeBus = createClient<Topic, TopicPayloads>('cart-runtime');
export const uiBus = createClient<Topic, TopicPayloads>('cart-ui');
