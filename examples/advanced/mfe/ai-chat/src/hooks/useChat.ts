import { useCallback, useEffect, useRef, useState } from 'react';

import { getBroker, SSETransport } from '@hedwigjs/broker';
import type { Topic, TopicPayloads } from '@hedwig-demo/contracts';

import { bus } from '../clients/bus';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
};

// Baked at build time by webpack's EnvironmentPlugin (see webpack.config.js).
const BACKEND_URL = process.env.AI_STREAM_URL as string;

const BRIDGE_ID = 'ai-backend-stream';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Chat state driven entirely by broker traffic.
 *
 * Wire:
 *  1. `send()` opens an EventSource against the backend and attaches an
 *     SSETransport bridge that injects `chat.reply-chunk.v1` and
 *     `chat.reply-completed.v1` into the local broker.
 *  2. Two `bus.on(...)` subscribers (filtered by replyId) update React
 *     state as chunks arrive and mark the message complete at the end.
 *  3. Cancel closes the EventSource (server sees `res.on('close')` and
 *     stops), then emits `chat.reply-cancelled.v1` locally.
 *
 * Every event is on the bus — DevTools sees the whole timeline
 * (message-sent, reply-started, N × reply-chunk, reply-completed) with
 * source labels showing which came from the local client vs. the backend
 * bridge ("external" badge in DevTools).
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setStreaming] = useState(false);

  // Per-request state — kept in refs because the bus subscribers are
  // long-lived and need to know which replyId is currently active.
  const activeReplyIdRef = useRef<string | null>(null);
  const activeRemoveBridgeRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef<string>('');

  const teardownActive = useCallback(() => {
    activeRemoveBridgeRef.current?.();
    activeRemoveBridgeRef.current = null;
    activeReplyIdRef.current = null;
    bufferRef.current = '';
    setStreaming(false);
  }, []);

  const cancel = useCallback(() => {
    const replyId = activeReplyIdRef.current;
    if (!replyId) return;
    const partial = bufferRef.current;

    void bus.emit('chat.reply-cancelled.v1', { replyId });
    setMessages((prev) =>
      prev.map((m) =>
        m.id === replyId ? { ...m, streaming: false, text: partial || '(отменено)' } : m,
      ),
    );
    teardownActive();
  }, [teardownActive]);

  // Global subscribers — receive every reply-chunk / reply-completed on
  // the bus and gate by the active replyId. Attaching once at mount keeps
  // the send() path simple (no per-request subscribe/unsubscribe churn).
  useEffect(() => {
    const offChunk = bus.on('chat.reply-chunk.v1', (msg) => {
      const { replyId, chunk } = msg.data;
      if (replyId !== activeReplyIdRef.current) return;
      bufferRef.current += chunk;
      const next = bufferRef.current;
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? { ...m, text: next } : m)),
      );
    });

    const offCompleted = bus.on('chat.reply-completed.v1', (msg) => {
      const { replyId, fullText } = msg.data;
      if (replyId !== activeReplyIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === replyId ? { ...m, streaming: false, text: fullText } : m,
        ),
      );
      teardownActive();
    });

    return () => {
      offChunk();
      offCompleted();
    };
  }, [teardownActive]);

  // Safety net: tear down the stream if the component unmounts mid-reply.
  useEffect(() => {
    return () => teardownActive();
  }, [teardownActive]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userId = uid();
      const replyId = uid();
      const userMsg: ChatMessage = { id: userId, role: 'user', text: trimmed };
      const assistantMsg: ChatMessage = {
        id: replyId,
        role: 'assistant',
        text: '',
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      void bus.emit('chat.message-sent.v1', {
        id: userId,
        text: trimmed,
        at: Date.now(),
      });
      void bus.emit('chat.reply-started.v1', {
        replyId,
        inReplyTo: userId,
      });

      activeReplyIdRef.current = replyId;
      bufferRef.current = '';
      setStreaming(true);

      // SSETransport opens its own EventSource against the URL and owns
      // the socket lifetime — teardownActive() calls transport.destroy()
      // which closes it. Bridge is per-request because the endpoint is
      // per-request (backend closes the stream after `chat.reply-completed`);
      // otherwise the browser would auto-reconnect and re-run the reply.
      const url = `${BACKEND_URL}?prompt=${encodeURIComponent(trimmed)}&replyId=${encodeURIComponent(replyId)}`;
      const transport = new SSETransport({ url });

      const broker = getBroker<Topic, TopicPayloads>();
      const removeBridge = broker.addBridge(BRIDGE_ID, {
        transport,
        forward: ['chat.reply-chunk.v1', 'chat.reply-completed.v1'],
      });

      // Teardown closure captures the exact transport/bridge for this
      // request. `broker.addBridge` returns a removal fn, and the
      // transport we manage explicitly since the bridge doesn't own it.
      activeRemoveBridgeRef.current = () => {
        removeBridge();
        transport.destroy();
      };
    },
    [isStreaming],
  );

  return { messages, isStreaming, send, cancel };
}
