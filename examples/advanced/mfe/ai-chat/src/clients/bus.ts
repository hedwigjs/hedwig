import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/** AI-chat's broker client. Publishes `chat.*` observability topics. */
export const bus = createClient<Topic, TopicPayloads>('ai-chat');
