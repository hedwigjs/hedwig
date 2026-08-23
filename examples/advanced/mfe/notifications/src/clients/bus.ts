import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** Notifications MFE's broker client — bridges WS → bus, consumes for toasts. */
export const bus = createClient<Topic, TopicPayloads>('notifications');
