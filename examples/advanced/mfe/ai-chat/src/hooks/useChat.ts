import { useCallback, useEffect, useRef, useState } from 'react';

import { bus } from '../clients/bus';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  streaming?: boolean;
};

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Chat state — pure UI logic driven by broker events.
 *
 * `send()` emits three events and returns; it knows nothing about HTTP.
 * The `chat.ask.v1` emit is picked up by aiStreamAdapter (a separate
 * subscriber) which opens the SSE stream and injects reply chunks back
 * onto the bus. This hook just watches for those chunks, filtered by
 * `replyId`, and drives React state.
 *
 * Cancel emits `chat.reply-cancelled.v1`; the adapter tears down its
 * bridge on the same event.
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setStreaming] = useState(false);

  // Which replyId we're currently rendering to. Kept in a ref because the
  // long-lived bus subscribers below need to filter by it without becoming
  // reactive to identity changes on every render.
  const activeReplyIdRef = useRef<string | null>(null);
  const bufferRef = useRef<string>('');

  const finish = useCallback(() => {
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
    finish();
  }, [finish]);

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
      finish();
    });

    return () => {
      offChunk();
      offCompleted();
    };
  }, [finish]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userId = uid();
      const replyId = uid();

      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', text: trimmed },
        { id: replyId, role: 'assistant', text: '', streaming: true },
      ]);

      activeReplyIdRef.current = replyId;
      bufferRef.current = '';
      setStreaming(true);

      void bus.emit('chat.message-sent.v1', {
        id: userId,
        text: trimmed,
        at: Date.now(),
      });
      void bus.emit('chat.reply-started.v1', {
        replyId,
        inReplyTo: userId,
      });
      // Fire the request onto the bus. The SSE bridge lives in
      // aiStreamAdapter — this hook doesn't know or care about HTTP.
      void bus.emit('chat.ask.v1', { prompt: trimmed, replyId });
    },
    [isStreaming],
  );

  return { messages, isStreaming, send, cancel };
}
