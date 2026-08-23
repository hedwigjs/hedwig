import type { Message, ClientID } from '../types';
import type { RoutingResult } from '../routing/RoutingResult';

/**
 * Result of hook execution
 */
export type HookResult = { allowed: true } | { allowed: false; message: string };

/**
 * Hook function types
 */
export type OnSubscribeHook<T> = (topic: T, clientId: ClientID) => HookResult;

/** Called before each message is sent. Return { allowed: false } to block. */
export type BeforeSendHook<T extends string, P extends Record<T, any>> = (
  message: Readonly<Message<T, P[T]>>,
) => HookResult;

/** Called after each message is sent. Receives delivery result. */
export type AfterSendHook<T extends string, P extends Record<T, any>> = (
  message: Readonly<Message<T, P[T]>>,
  messageResult: RoutingResult,
) => void;

