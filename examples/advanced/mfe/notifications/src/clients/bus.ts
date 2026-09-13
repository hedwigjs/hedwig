import { createClient } from '@hedwigjs/client';
import { bindHooks } from '@hedwigjs/react';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

export const toastBus = createClient<Topic, TopicPayloads, TopicContracts>('notifications-toast');

/** Hooks with `toastBus` already filled in: `useTopic('notification.show.v1', …)`. */
export const { useTopic, useStateTopic } = bindHooks(toastBus);
