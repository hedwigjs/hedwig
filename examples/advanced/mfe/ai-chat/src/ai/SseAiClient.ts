import type { AiClient } from './AiClient';

type SseEvent = {
  event: string;
  data: string;
};

/**
 * Читает SSE-стрим backend'а и превращает `event: chunk` в чанки текста.
 *
 * Backend отдаёт события: `start` (метаданные), `chunk` (кусок текста),
 * `done` (полный ответ + завершение). Нас интересуют только `chunk`.
 * `signal` разрывает соединение — server слушает `res.on('close')` и
 * останавливает генерацию.
 */
export class SseAiClient implements AiClient {
  constructor(private readonly url: string) {}

  async *ask(text: string, signal?: AbortSignal): AsyncIterable<string> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ prompt: text }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`AI backend responded with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) return;
        const { value, done } = await reader.read();
        if (done) return;

        buffer += decoder.decode(value, { stream: true });

        // SSE-события разделены пустой строкой ("\n\n").
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const parsed = parseEvent(raw);
          if (!parsed) continue;

          if (parsed.event === 'chunk') {
            try {
              const payload = JSON.parse(parsed.data) as { chunk?: string };
              if (typeof payload.chunk === 'string') yield payload.chunk;
            } catch {
              // Молча пропускаем сломанные события — стрим не должен падать.
            }
          } else if (parsed.event === 'done') {
            return;
          }
        }
      }
    } finally {
      // Если consumer прервал итерацию до конца — отпускаем body.
      try {
        await reader.cancel();
      } catch {
        // no-op
      }
    }
  }
}

function parseEvent(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
