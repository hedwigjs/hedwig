import { useCallback, useRef, useState } from 'react';

import { bus } from '../clients/bus';
import { SseAiClient } from '../ai/SseAiClient';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
};

const BACKEND_URL =
  (typeof process !== 'undefined' && process.env?.AI_STREAM_URL) ||
  'http://localhost:4000/ai/stream';

const client = new SseAiClient(BACKEND_URL);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Chat state + AI streaming.
 *
 * Every user action and every incoming chunk is also published on the
 * mock bus under `chat.*` topics — later this is what @hedwigjs/devtools
 * will visualise as a live timeline.
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = { id: uid(), role: 'user', text: trimmed };
    const replyId = uid();
    const assistantMsg: ChatMessage = {
      id: replyId,
      role: 'assistant',
      text: '',
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    void bus.emit('chat.message-sent.v1', {
      id: userMsg.id,
      text: trimmed,
      at: Date.now(),
    });
    void bus.emit('chat.reply-started.v1', {
      replyId,
      inReplyTo: userMsg.id,
    });

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    let full = '';
    try {
      for await (const chunk of client.ask(trimmed, controller.signal)) {
        full += chunk;
        void bus.emit('chat.reply-chunk.v1', { replyId, chunk });
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, text: full } : m)),
        );
      }
      void bus.emit('chat.reply-completed.v1', { replyId, fullText: full });
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)),
      );
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        void bus.emit('chat.reply-cancelled.v1', { replyId });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId ? { ...m, streaming: false, text: full || '(отменено)' } : m,
          ),
        );
      } else {
        throw err;
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming]);

  return { messages, isStreaming, send, cancel };
}
