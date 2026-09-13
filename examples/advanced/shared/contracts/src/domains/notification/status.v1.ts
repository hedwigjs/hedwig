import type { EventContract } from "../../lib/contract";

/**
 * Answer of the notifications backend: how many clients its WebSocket
 * server currently holds and how long the process has been up. The
 * request travels over the wire to the `notifications-backend` remote
 * client and the backend answers with a `kind: 'response'` frame.
 */
export type NotificationStatusResponse = {
  connected: number;
  uptimeMs: number;
  lang: "en" | "ru";
  serverTime: number;
};

export default {
  name: "notification.status.v1",
  description:
    "Request to the notifications backend (a remote client over WebSocket): connected clients and process uptime. Demonstrates a request answered across a transport — correlationId, deadline, and NACK TIMEOUT / REMOTE_GONE when the backend is away.",
  payload: {} as { includeLang?: boolean },
  examples: {
    happy: { includeLang: true },
  },
} as const satisfies EventContract;
