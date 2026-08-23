import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** Checkout MFE's broker client — listens to cart.checkout-requested, emits checkout.* and clean-up cart events. */
export const bus = createClient<Topic, TopicPayloads>('checkout');
