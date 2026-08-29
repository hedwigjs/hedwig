import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** Menu MFE's broker client. Module-singleton, imported by any menu-side code. */
export const bus = createClient<Topic, TopicPayloads>('menu');
