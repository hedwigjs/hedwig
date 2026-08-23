import { getBroker, SSETransport } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { adapterBus } from './clients/bus';

const BACKEND_URL =
  (typeof process !== 'undefined' && process.env?.AI_STREAM_URL) ||
  'http://localhost:4000/ai/stream';

/**
 * Turns `chat.ask.v1` events into an actual SSE request against the
 * backend and injects the reply stream into the local broker.
 *
 * The rest of the app (feature hooks, components) only knows the topic:
 * emit `chat.ask.v1` and expect `chat.reply-chunk.v1` × N +
 * `chat.reply-completed.v1` to flow back, correlated by `replyId`. Swap
 * the transport here (WebSocket / POST+polling / native fetch stream)
 * without touching any caller.
 */
export function installAiStreamAdapter(): () => void {
  const broker = getBroker<Topic, TopicPayloads>();

  return adapterBus.on('chat.ask.v1', (msg) => {
    const { prompt, replyId } = msg.data;
    const url = `${BACKEND_URL}?prompt=${encodeURIComponent(prompt)}&replyId=${encodeURIComponent(replyId)}`;

    const transport = new SSETransport({ url });
    const removeBridge = broker.addBridge(`ai-stream-${replyId}`, {
      transport,
      forward: ['chat.reply-chunk.v1', 'chat.reply-completed.v1'],
    });

    // Per-request teardown. The backend ends the stream after
    // reply-completed, so if we don't tear down explicitly the browser's
    // EventSource auto-reconnect would re-open the connection and the
    // reply would fire again. Same for cancellation from the client side.
    const teardown = () => {
      removeBridge();
      transport.destroy();
      offCompleted();
      offCancelled();
    };

    const offCompleted = adapterBus.on('chat.reply-completed.v1', (m) => {
      if (m.data.replyId === replyId) teardown();
    });
    const offCancelled = adapterBus.on('chat.reply-cancelled.v1', (m) => {
      if (m.data.replyId === replyId) teardown();
    });
  });
}
