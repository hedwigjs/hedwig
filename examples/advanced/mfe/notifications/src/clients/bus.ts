import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/**
 * Notifications MFE is a pure READER on the bus — it only subscribes to
 * `notification.show.v1` so other MFEs (checkout, etc.) can request a
 * toast. The server-pushed WebSocket path is intentionally NOT routed
 * through the bus: source and sink for that flow both live inside this
 * MFE, so a direct write into local state is the right transport. Only
 * cross-MFE traffic goes through the broker.
 */
export const toastBus = createClient<Topic, TopicPayloads>('notifications-toast');
