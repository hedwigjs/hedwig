/**
 * A pipe between this realm and one peer.
 *
 * Three methods carry the traffic; the optional members describe the pipe
 * so the runtime can decide what is allowed over it. Built-in transports
 * (WebSocket, SSE, postMessage, MessagePort, BroadcastChannel) implement
 * this; custom ones (WebRTC, Electron IPC, …) only need the three methods.
 *
 * ## Contract
 *
 * - `send(frame)` hands a JSON-serialisable frame to the wire. Should not
 *   throw; the runtime isolates a throwing send per remote regardless.
 * - `onMessage(cb)` subscribes to inbound frames once, at creation. Return
 *   an unsubscribe function.
 * - `destroy()` releases everything. Must be idempotent.
 * - `duplex` — `false` for inbound-only pipes (SSE). Default `true`.
 * - `fanout` — `true` when one `send` reaches many peers and inbound frames
 *   may come from any of them (BroadcastChannel). Default `false`. A
 *   fan-out transport can never carry requests.
 * - `ready` — resolves when frames can be sent (socket open, iframe
 *   loaded). Default: already resolved. The runtime defers outbound frames
 *   until then.
 * - `onClose(cb)` — optional notification that the pipe is gone; lets the
 *   runtime tear the remote client down instead of waiting for timeouts.
 *
 * Transports are the trust boundary between the broker and the outside
 * world for *origin* checks (postMessage). Identity and topic policy live
 * on the remote client, not in the transport.
 */
export interface Transport {
  send(frame: unknown): void;
  onMessage(callback: (frame: unknown) => void): () => void;
  destroy(): void;
  readonly duplex?: boolean;
  readonly fanout?: boolean;
  readonly ready?: Promise<void>;
  onClose?(callback: () => void): () => void;
}

/**
 * Descriptor for a built-in transport. A module names the kind and the
 * runtime instantiates its own implementation — the transport code never
 * ships in the module's bundle.
 */
export type TransportDescriptor =
  | {
      kind: 'postmessage';
      target: Window;
      /** Inbound allow-list; frames from other origins are dropped. */
      allowedOrigins: string[];
      /** Outbound target origin for `postMessage`. Never `'*'`. */
      targetOrigin: string;
    }
  | { kind: 'message-port'; port: MessagePort }
  | { kind: 'websocket'; socket: WebSocket }
  | { kind: 'sse'; url: string; withCredentials?: boolean; eventName?: string }
  | { kind: 'broadcast-channel'; name: string };

export type TransportKind = TransportDescriptor['kind'];

export function isTransportDescriptor(value: unknown): value is TransportDescriptor {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    typeof (value as { send?: unknown }).send !== 'function'
  );
}
