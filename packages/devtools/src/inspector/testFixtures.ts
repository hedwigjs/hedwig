import type { Message, RoutingResult } from "@hedwigjs/broker";
import { RoutingReason } from "@hedwigjs/broker";

export function makeTestMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    topic: "test.topic",
    source: "client-a",
    target: "client-b",
    data: { n: 1 },
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeAck(): RoutingResult {
  return {
    status: "ACK",
    reason: RoutingReason.DELIVERED,
    message: "ok",
    timestamp: 0,
  } as RoutingResult;
}

export function makeNack(): RoutingResult {
  return {
    status: "NACK",
    reason: RoutingReason.NO_SUBSCRIBERS,
    message: "nope",
    timestamp: 0,
  } as RoutingResult;
}
