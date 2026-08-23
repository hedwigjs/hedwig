import { getBroker, SSETransport } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

const NOTIFICATIONS_SSE_URL =
  (typeof process !== 'undefined' && process.env?.NOTIFICATIONS_SSE_URL) ||
  'http://localhost:4000/sse/notifications';

const BRIDGE_ID = 'backend-notifications';

/**
 * Connect the backend notifications SSE stream to the local broker via
 * SSETransport.
 *
 * Why SSE over WebSocket: this channel is server → client only. SSE gives
 * us built-in reconnect (browser handles it), HTTP-native transport
 * (traverses proxies without WS upgrade headaches), and a smaller server
 * footprint. WebSocketTransport is still exported and available for
 * duplex flows.
 *
 * The bridge lives here in the shell so consumer MFEs
 * (`notifications-toast`) stay pure subscribers.
 */
export function installBackendNotificationsBridge(): () => void {
  const broker = getBroker<Topic, TopicPayloads>();

  const transport = new SSETransport({
    url: NOTIFICATIONS_SSE_URL,
  });

  const removeBridge = broker.addBridge(BRIDGE_ID, {
    transport,
    // Only inbound topics from this stream — SSE has no upstream channel
    // so nothing goes out on this wire even if the pattern matched.
    forward: ['notification.show.v1'],
  });

  return () => {
    removeBridge();
    transport.destroy();
  };
}
