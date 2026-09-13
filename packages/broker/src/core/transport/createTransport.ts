import type { Transport, TransportDescriptor, TransportKind } from './Transport.types';
import { PostMessageTransport } from '../../transports/PostMessageTransport';
import { MessagePortTransport } from '../../transports/MessagePortTransport';
import { WebSocketTransport } from '../../transports/WebSocketTransport';
import { SSETransport } from '../../transports/SSETransport';
import { BroadcastChannelTransport } from '../../transports/BroadcastChannelTransport';

/** Transport kinds this runtime provides; advertised as `transport.<kind>` capabilities. */
export const BUILT_IN_TRANSPORT_KINDS: ReadonlyArray<TransportKind> = [
  'postmessage',
  'message-port',
  'websocket',
  'sse',
  'broadcast-channel',
];

/**
 * Instantiate a built-in transport from its descriptor.
 *
 * @throws `TRANSPORT_UNSUPPORTED` for an unknown `kind` — the error message
 *   lists what this runtime provides.
 */
export function createTransport(descriptor: TransportDescriptor): Transport {
  switch (descriptor.kind) {
    case 'postmessage':
      return new PostMessageTransport({
        target: descriptor.target,
        allowedOrigins: descriptor.allowedOrigins,
        targetOrigin: descriptor.targetOrigin,
      });
    case 'message-port':
      return new MessagePortTransport(descriptor.port);
    case 'websocket':
      return new WebSocketTransport(descriptor.socket);
    case 'sse':
      return new SSETransport({
        url: descriptor.url,
        withCredentials: descriptor.withCredentials,
        eventName: descriptor.eventName,
      });
    case 'broadcast-channel':
      return new BroadcastChannelTransport(descriptor.name);
    default: {
      const kind = String((descriptor as { kind?: unknown }).kind);
      const error = new Error(
        `@hedwigjs/broker: unsupported transport kind '${kind}'. This runtime provides: ${BUILT_IN_TRANSPORT_KINDS.join(', ')}.`,
      );
      (error as Error & { code: string }).code = 'TRANSPORT_UNSUPPORTED';
      throw error;
    }
  }
}
