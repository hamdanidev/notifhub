import { isAbortError, NotifHubError } from './errors';

export interface SseMessage {
  data: string;
  event?: string;
  id?: string;
}

export interface StreamEventsOptions {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  onOpen: (response: Response) => Promise<void> | void;
  onMessage: (message: SseMessage) => void;
}

/**
 * Fetch-based Server-Sent Events transport (PART 1 rule 40: never use the browser
 * EventSource, which cannot send an Authorization header and would force the token
 * into the query string).
 *
 * Implements the SSE line protocol: `event:`, `data:`, `id:`, `retry:` fields, comments
 * (including the `:` heartbeat), multi-line data and dispatch on a blank line.
 */
export async function streamEvents(options: StreamEventsOptions): Promise<void> {
  let response: Response;

  try {
    response = await options.fetchImpl(options.url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw toStreamError(error, options.signal);
  }

  // onOpen validates the handshake and throws typed errors (401/403/5xx/invalid content type).
  await options.onOpen(response);

  if (response.body === null) {
    throw new NotifHubError('invalid_response', 'SSE response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value !== undefined) {
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          options.onMessage(message);
        }
      }
    }

    for (const message of parser.flush()) {
      options.onMessage(message);
    }
  } catch (error) {
    throw toStreamError(error, options.signal);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or aborted; nothing else to release.
    }
  }
}

export class SseParser {
  private buffer = '';
  private eventId: string | undefined;
  private eventName: string | undefined;
  private readonly dataLines: string[] = [];

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      this.handleLine(line, messages);
      newlineIndex = this.buffer.indexOf('\n');
    }

    return messages;
  }

  /** Dispatches a final event when the stream ends without a trailing blank line. */
  flush(): SseMessage[] {
    const messages: SseMessage[] = [];

    if (this.buffer.length > 0) {
      let line = this.buffer;
      this.buffer = '';

      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      this.handleLine(line, messages);
    }

    this.dispatch(messages);

    return messages;
  }

  private handleLine(line: string, messages: SseMessage[]): void {
    if (line === '') {
      this.dispatch(messages);
      return;
    }

    if (line.startsWith(':')) {
      // Comment, including the heartbeat ":" frames sent every 15-30 seconds.
      return;
    }

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);

    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\u0000')) {
          this.eventId = value;
        }
        break;
      case 'retry':
        // Reconnection timing is owned by the SDK backoff policy, not by the server hint.
        break;
      default:
        break;
    }
  }

  private dispatch(messages: SseMessage[]): void {
    if (this.dataLines.length === 0) {
      // A block without data is not an event (e.g. a retry-only block).
      this.eventName = undefined;
      return;
    }

    const message: SseMessage = { data: this.dataLines.join('\n') };

    if (this.eventId !== undefined) {
      message.id = this.eventId;
    }

    if (this.eventName !== undefined) {
      message.event = this.eventName;
    }

    messages.push(message);
    this.dataLines.length = 0;
    this.eventName = undefined;
  }
}

function toStreamError(error: unknown, signal: AbortSignal): NotifHubError {
  if (signal.aborted || isAbortError(error)) {
    return new NotifHubError('aborted', 'Operation aborted');
  }

  return new NotifHubError('network_error', error instanceof Error ? error.message : String(error), {
    retryable: true,
    cause: error,
  });
}
