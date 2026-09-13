import { createClient } from '@hedwigjs/client';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

/**
 * Analytics MFE's broker client. Semi-trusted — the ACL configured in the
 * shell restricts subscriptions to a small allowlist of anonymous UI events
 * and denies every send. Used to demonstrate broker-level `onSubscribe` and
 * `beforeSend` hooks.
 */
export const bus = createClient<Topic, TopicPayloads, TopicContracts>('analytics');
