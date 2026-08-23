import { createClient } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

/**
 * AI-chat MFE holds two identities on the bus:
 *
 * - `bus` — feature client. Emits `chat.message-sent.v1`, `chat.ask.v1`
 *   etc. from `useChat`; subscribes to `chat.reply-*` topics to drive UI.
 * - `adapterBus` — the request-handling side. Subscribes to `chat.ask.v1`
 *   and opens an SSE bridge to the backend (see aiStreamAdapter.ts).
 *
 * Two identities because broker excludes senders from their own multicast:
 * if adapter used `bus` it would never see the ask event that `bus` itself
 * just emitted. Same class of split as cart runtime vs cart ui.
 */
export const bus = createClient<Topic, TopicPayloads>('ai-chat');
export const adapterBus = createClient<Topic, TopicPayloads>('ai-chat-adapter');
