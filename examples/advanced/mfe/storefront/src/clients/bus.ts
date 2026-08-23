import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** Storefront's broker client. Module-singleton, imported by any storefront code. */
export const bus = createClient<Topic, TopicPayloads>('storefront');
