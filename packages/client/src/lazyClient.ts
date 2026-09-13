import type { Client, ClientOptions } from './types/client';
import type { HandlerFn, MessageOptions, RequestOptions, SubscriptionOptions } from './types/message';
import type { RoutingResult } from './types/routing';
import { RoutingReason } from './types/routing';
import type { ClientMeta, RuntimeHandle } from './handle';
import { onRuntimeReady, tryGetRuntime } from './locator';

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

/**
 * A client created before the runtime exists. Subscriptions are recorded,
 * emits and requests are queued (bounded), and everything is replayed in
 * order against the real client the moment a runtime registers. After
 * binding, every call is a plain forward. Modules can therefore create
 * their client at module scope without caring about boot order.
 */
export class LazyClient<T extends string, P extends Record<T, any>> implements Client<T, P> {
  readonly id: string;
  #options: ClientOptions | undefined;
  #meta: ClientMeta;
  #limit: number;
  #subscriptions: Subscription[] = [];
  #queue: Queued[] = [];
  #real: Client<T, P> | null = null;
  #destroyed = false;
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

  /** True once calls go straight to the runtime. */
  get bound(): boolean {
    return this.#real !== null;
  }

  /** Emits and requests waiting for a runtime. */
  get queued(): number {
    return this.#queue.length;
  }

  #tryBind(): void {
    if (this.#real || this.#destroyed) return;
    const runtime: RuntimeHandle | undefined = tryGetRuntime();
    if (!runtime) return;
    this.#unsubscribeReady?.();
    this.#unsubscribeReady = null;
    const real = runtime.createClient(this.id, this.#options, this.#meta) as Client<T, P>;
    this.#real = real;
    for (const sub of this.#subscriptions) {
      if (sub.removed) continue;
      sub.off = real.on(sub.topic as T, sub.handler, sub.options);
    }
    const queue = this.#queue.splice(0);
    for (const q of queue) {
      const promise =
        q.kind === 'emit'
          ? real.emit(q.topic as T, q.data as P[T], q.options)
          : real.request(q.recipient, q.topic as T, q.data as P[T], q.options);
      promise.then(q.resolve, () => q.resolve(notReady('Runtime rejected the queued call')));
    }
  }

  on<K extends T>(topic: K, handler: HandlerFn<K, P[K]>, options?: SubscriptionOptions): () => void {
    if (this.#real) return this.#real.on(topic, handler, options);
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

  emit<K extends T>(topic: K, data: P[K], options?: MessageOptions): Promise<RoutingResult> {
    if (this.#real) return this.#real.emit(topic, data, options);
    return this.#enqueue({ kind: 'emit', recipient: '*', topic, data, options });
  }

  request<K extends T, R = unknown>(
    recipient: string,
    topic: K,
    data: P[K],
    options?: RequestOptions,
  ): Promise<RoutingResult<R>> {
    if (this.#real) return this.#real.request<K, R>(recipient, topic, data, options);
    return this.#enqueue({ kind: 'request', recipient, topic, data, options }) as Promise<RoutingResult<R>>;
  }

  #enqueue(call: Omit<Queued, 'resolve'>): Promise<RoutingResult> {
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
