/**
 * @hedwigjs/react
 *
 * Hooks that bind Hedwig clients to the component lifecycle. Built on
 * `@hedwigjs/client`; no dependency on the runtime.
 *
 *   - `useClient(id)`               — a client for the component's lifetime
 *   - `useTopic(client, topic, fn)`  — subscribe while mounted, latest handler wins
 *   - `useStateTopic(client, topic)` — the retained value of a state topic, before first paint
 *   - `useRequest(client, to, topic)`— `send()` + `pending` / `result`, answer typed by the contract
 *   - `useRemoteClient(id, opts)`    — a remote client for the component's (or the options') lifetime
 *   - `useRuntimeReady()`            — whether the host's runtime is there yet
 *   - `bindHooks(client)`            — the three data hooks with the client filled in
 */

export { useClient } from './useClient';
export { useTopic } from './useTopic';
export { useStateTopic } from './useStateTopic';
export { useRequest } from './useRequest';
export type { RequestHandle } from './useRequest';
export { useRemoteClient } from './useRemoteClient';
export { useRuntimeReady } from './useRuntimeReady';
export { bindHooks } from './bindHooks';
export type { BoundHooks } from './bindHooks';
