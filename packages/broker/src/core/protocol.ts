/**
 * Version of the internal client ↔ core protocol.
 *
 * Bump this — and only this — when the contract between `BrokerClient`,
 * the facade and `BrokerCore` changes in a way that a client bundled with
 * an older copy of the library could no longer talk to a newer core (or
 * vice versa). It is deliberately decoupled from the npm version: every
 * 0.x release shares major `0`, yet some of them will change internals.
 *
 * The value keys the per-realm registry slot (see {@link GLOBAL_REGISTRY_KEY}),
 * so copies of the library that speak different protocols never share an
 * instance — they get separate brokers and a loud `broker.protocol_mismatch`
 * warning instead of a silent crash inside foreign code.
 *
 * Compatibility rule for consumers: a client bundle built against protocol
 * `N` works with any core of protocol `N`, regardless of npm patch/minor.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Registry key on `globalThis`. `Symbol.for` resolves to the same symbol
 * from every copy of this module within one realm — that is the whole
 * point: two bundled copies find each other through the global symbol
 * registry, not through module identity.
 *
 * Scope is ONE realm (one window / worker). An iframe or a Worker has its
 * own `globalThis`, its own broker and talks through a bridge; sharing an
 * instance across realms is neither possible for cross-origin frames nor
 * advisable for same-origin ones (subscriptions of an unloaded frame would
 * leak, cross-realm objects break `instanceof`).
 */
export const GLOBAL_REGISTRY_KEY: unique symbol = Symbol.for('@hedwigjs/broker') as never;
