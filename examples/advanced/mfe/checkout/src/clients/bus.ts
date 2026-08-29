import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** Checkout MFE's broker client — handles `checkout.start.v1` requests from cart, emits checkout.* events, and sends cart.remove-item.v1 requests to clean up on completion. */
export const bus = createClient<Topic, TopicPayloads>('checkout');
