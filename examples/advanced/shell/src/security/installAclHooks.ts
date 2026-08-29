import { getBroker } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { ACL, isSendAllowed, isSubscribeAllowed } from './acl';

/**
 * Wire the declarative ACL into the broker via its two extension hooks.
 *
 *  - `useOnSubscribeHook` — runs when a client calls `bus.on(topic, ...)`.
 *    Returning `allowed: false` makes `on()` throw so the caller sees the
 *    denial in-place. No subscription is registered.
 *
 *  - `useBeforeSendHook` — runs before every outgoing message. Returning
 *    `allowed: false` short-circuits the pipeline with a `NACK
 *    HOOK_REJECTED` RoutingResult. Sender sees the rejection via the
 *    Promise returned by `emit`/`request`; the failed message still shows
 *    up in DevTools (marked NACK) so the demo audience can see the block.
 *
 * Both hooks are additive — installing this alongside other hooks (e.g. a
 * rate limiter) doesn't require any coordination.
 */
export function installAclHooks(): void {
  const broker = getBroker<Topic, TopicPayloads>();

  broker.useOnSubscribeHook((topic, clientId) => {
    if (isSubscribeAllowed(ACL, clientId, topic)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      message: `[ACL] '${clientId}' is not allowed to subscribe to '${topic}'`,
    };
  });

  broker.useBeforeSendHook((message) => {
    if (isSendAllowed(ACL, message.source, message.target, message.topic)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      message: `[ACL] '${message.source}' is not allowed to send '${message.topic}' to '${message.target}'`,
    };
  });
}
