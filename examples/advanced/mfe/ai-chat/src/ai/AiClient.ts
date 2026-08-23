/**
 * AI backend abstraction — same shape whether the source is a canned mock,
 * an SSE stream, or a WebSocket. UI never touches transport specifics.
 */
export interface AiClient {
  /**
   * Send the user's message. Returns an async iterable of text chunks.
   * Each chunk is a piece of the reply text (usually 1–6 chars).
   */
  ask(text: string, signal?: AbortSignal): AsyncIterable<string>;
}
