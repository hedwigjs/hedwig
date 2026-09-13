import { createClient } from '@hedwigjs/client';
import { bindHooks } from '@hedwigjs/react';
import type { Topic, TopicContracts, TopicPayloads } from '@hedwig-demo/contracts';

export const bus = createClient<Topic, TopicPayloads, TopicContracts>('menu');

/** Hooks with `bus` already filled in: `useStateTopic('cart.snapshot.v1')`. */
export const { useStateTopic, useTopic, useRequest } = bindHooks(bus);
