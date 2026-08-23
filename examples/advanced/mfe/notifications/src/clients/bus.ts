import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/**
 * Notifications MFE has two distinct roles on the bus and each needs its
 * own identity — broker excludes senders from their own multicast, so if
 * both the WS bridge and the toast queue shared one client, the toast
 * would never see server-pushed notifications.
 *
 * - `wsBus`  — inbound bridge. Reads envelopes off the backend WebSocket
 *   and re-emits them onto the bus as `notification.show.v1`.
 * - `toastBus` — outbound consumer. Subscribes to `notification.show.v1`
 *   and drives the on-screen toast queue.
 */
export const wsBus = createClient<Topic, TopicPayloads>('notifications-ws');
export const toastBus = createClient<Topic, TopicPayloads>('notifications-toast');
