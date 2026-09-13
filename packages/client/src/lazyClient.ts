import type { Client, ClientOptions } from './types/client';
import type { HandlerFn, MessageOptions, RequestOptions, SubscriptionOptions } from './types/message';
import type { RoutingResult } from './types/routing';
import { RoutingReason } from './types/routing';
import type { EmitTopic, RequestTopic, ResponseOf, TopicContractsMap } from './types/contracts';
import type { ClientMeta, RuntimeHandle } from './handle';
import { getRuntime, onRuntimeReady, tryGetRuntime } from './locator';
import { readHandle } from './handle';

/** Default bound on queued `emit()` / `request()` calls before the runtime exists. */
export const DEFAULT_QUEUE_LIMIT = 64;

interface Subscription {
  topic: string;
  handler: HandlerFn<any, any>;
  options: SubscriptionOptions | undefined;
  /** Set once bound; `null` before. */
  off: (() => void) | null;
  removed: boolean;
}

interface Queued {
  kind: 'emit' | 'request';
  recipient: string;
  topic: string;
  data: unknown;
  options: MessageOptions | RequestOptions | undefined;
  resolve: (result: RoutingResult<any>) => void;
}

function notReady(message: string): RoutingResult {
  return Object.freeze({
    status: 'NACK' as const,
    reason: RoutingReason.RUNTIME_NOT_READY,
    message,
    timestamp: Date.now(),
  });
}

function tooOld(message: string): RoutingResult {
  return Object.freeze({
    status: 'NACK' as const,
    reason: RoutingReason.RUNTIME_TOO_OLD,
    message,
    timestamp: Date.now(),
  });
}

/** `RUNTIME_TOO_OLD` from the locator, or `null` when the handle is absent or fine. */
function tooOldError(): Error | null {
  if (!readHandle()) return null;
  try {
    getRuntime();
    return null;
  } catch (error) {
    return (error as { code?: string }).code === 'RUNTIME_TOO_OLD' ? (error as Error) : null;
  }
}

/**
 * A client created before the runtime exists. Subscriptions are recorded,
 * emits and requests are queued (bounded), and everything is replayed in
 * order against the real client the moment a runtime registers. After
 * binding, every call is a plain forward. Modules can therefore create
 * their client at module scope without caring about boot order.
 *
 * A runtime that is too old for this SDK (`RUNTIME_TOO_OLD`) never binds:
 * the client is *blocked* — `on()` records nothing, `emit()` / `request()`
 * answer `NACK RUNTIME_TOO_OLD` — and the reason is logged once. The
 * module keeps loading; nothing throws at import time.
 */
export class LazyClient<
  T extends string,
  P extends Record<T, any>,
  C extends TopicContractsMap<T> = TopicContractsMap<T>,
> implements Client<T, P, C> {
  readonly id: string;
  #options: ClientOptions | undefined;
  #meta: ClientMeta;
  #limit: number;
  #subscriptions: Subscription[] = [];
  #queue: Queued[] = [];
  #real: Client<T, P, C> | null = null;
  #destroyed = false;
  #blocked: Error | null = null;
  #unsubscribeReady: (() => void) | null;

  constructor(id: string, options: ClientOptions | undefined, meta: ClientMeta, queueLimit: number = DEFAULT_QUEUE_LIMIT) {
    this.id = id;
    this.#options = options;
    this.#meta = meta;
    this.#limit = queueLimit;
    this.#unsubscribeReady = onRuntimeReady(() => this.#tryBind());
    // The runtime may have appeared between the caller's check and ours.
    this.#tryBind();
  }

  /** The `RUNTIME_TOO_OLD` error that keeps this client from ever binding, if any. */
  get blocked(): Error | null {
    return this.#blocked;
  }

  /** True once calls go straight to the runtime. */
  get bound(): boolean {
    return this.#real !== null;
  }

  /** Emits and requests waiting for a runtime. */
  get queued(): number {
    return this.#queue.length;
  }

  #tryBind(): void {
    if (this.#real || this.#destroyed || this.#blocked) return;
    const runtime: RuntimeHandle | undefined = tryGetRuntime();
    if (!runtime) {
      const old = tooOldError();
      if (old) this.#block(old);
      return;
    }
    this.#unsubscribeReady?.();
    this.#unsubscribeReady = null;
    const real = runtime.createClient(this.id, this.#options, this.#meta) as Client<T, P, C>;
    this.#real = real;
    // Binding is isolated per subscription: a rejected one (an onSubscribe
    // hook said no) must not stop the others from binding or the queue from
    // flushing — a stuck queue would look like a runtime that never came.
    // The runtime has already published `subscription.rejected`; here the
    // module author gets a console line, the same as `on()` throwing would
    // have given them had the runtime been there.
    for (const sub of this.#subscriptions) {
      if (sub.removed) continue;
      try {
        sub.off = real.on(sub.topic as T, sub.handler, sub.options);
      } catch (error) {
        sub.removed = true;
        console.error(`@hedwigjs/client: subscription of '${this.id}' to '${sub.topic}' was rejected when the runtime appeared:`, error);
      }
    }
    const queue = this.#queue.splice(0);
    // Queued calls were typed at the call site; replay them untyped.
    const loose = real as unknown as Client<string, Record<string, unknown>>;
    for (const q of queue) {
      const promise =
        q.kind === 'emit'
          ? loose.emit(q.topic, q.data, q.options as MessageOptions | undefined)
          : loose.request(q.recipient, q.topic, q.data, q.options as RequestOptions | undefined);
      promise.then(q.resolve, () => q.resolve(notReady('Runtime rejected the queued call')));
    }
  }

  /** Too-old runtime: settle the queue, forget the subscriptions, say why once. */
  #block(error: Error): void {
    this.#blocked = error;
    this.#unsubscribeReady?.();
    this.#unsubscribeReady = null;
    this.#subscriptions = [];
    for (const q of this.#queue.splice(0)) q.resolve(tooOld(error.message));
    console.error(`@hedwigjs/client: client '${this.id}' will never bind — ${error.message}`);
  }

  on<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): () => void {
    if (this.#real) return this.#real.on(topic, handler, options);
    // Same rule as the runtime, raised now rather than at bind time.
    if (typeof topic !== 'string' || topic.includes('*')) {
      throw new TypeError(`on(): '${String(topic)}' is not a topic name. Subscriptions take exact names.`);
    }
    if (this.#blocked) return () => {};
    const sub: Subscription = { topic, handler, options, off: null, removed: false };
    this.#subscriptions.push(sub);
    return () => {
      sub.removed = true;
      sub.off?.();
      sub.off = null;
    };
  }

  off<K extends T>(topic: K): void {
    if (this.#real) {
      this.#real.off(topic);
      return;
    }
    for (const sub of this.#subscriptions) {
      if (sub.topic === topic) sub.removed = true;
    }
  }

  emit<K extends T & EmitTopic<T, C>>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult> {
    if (this.#real) return this.#real.emit(topic, data, options);
    return this.#enqueue({ kind: 'emit', recipient: '*', topic, data, options });
  }

  request<K extends T & RequestTopic<T, C>, R = ResponseOf<C, K>>(
    recipient: string,
    topic: K,
    data: P[K],
    options?: RequestOptions,
  ): Promise<RoutingResult<R>> {
    if (this.#real) return this.#real.request<K, R>(recipient, topic, data, options);
    return this.#enqueue({ kind: 'request', recipient, topic, data, options }) as Promise<RoutingResult<R>>;
  }

  #enqueue(call: Omit<Queued, 'resolve'>): Promise<RoutingResult> {
    if (this.#blocked) {
      return Promise.resolve(tooOld(this.#blocked.message));
    }
    if (this.#destroyed) {
      return Promise.resolve(notReady(`Client '${this.id}' was destroyed before a runtime existed`));
    }
    return new Promise<RoutingResult>((resolve) => {
      this.#queue.push({ ...call, resolve });
      if (this.#queue.length > this.#limit) {
        // Bounded buffer: the oldest call is dropped, and told so.
        const dropped = this.#queue.shift()!;
        dropped.resolve(
          notReady(`No Hedwig runtime yet and the queue of ${this.#limit} calls is full; '${dropped.topic}' was dropped`),
        );
      }
    });
  }

  reset(): void {
    if (this.#real) {
      this.#real.reset();
      return;
    }
    this.#subscriptions = [];
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribeReady?.();
    this.#unsubscribeReady = null;
    if (this.#real) {
      this.#real.destroy();
      return;
    }
    this.#subscriptions = [];
    for (const q of this.#queue.splice(0)) {
      q.resolve(notReady(`Client '${this.id}' was destroyed before a runtime existed`));
    }
  }
}
