import { describe, expect, it } from 'vitest';
import { SseParser, streamEvents, type SseMessage } from '../src/sse-transport';

describe('SseParser', () => {
  it('parses events split across arbitrary chunks', () => {
    const parser = new SseParser();
    const messages: SseMessage[] = [];

    messages.push(
      ...parser.push('retry: 5000\n\nid: 1-0\nevent: notification\ndata: {"a":'),
      ...parser.push('1}\n\n'),
    );

    expect(messages).toEqual([
      { id: '1-0', event: 'notification', data: '{"a":1}' },
    ]);
  });

  it('ignores heartbeat comments and retry-only blocks', () => {
    const parser = new SseParser();
    const messages = parser.push(':\n\nretry: 5000\n\ndata: ok\n\n');

    expect(messages).toEqual([{ data: 'ok' }]);
  });

  it('joins multi-line data and supports CRLF', () => {
    const parser = new SseParser();
    const messages = parser.push('event: notification\r\ndata: line1\r\ndata: line2\r\n\r\n');

    expect(messages).toEqual([{ event: 'notification', data: 'line1\nline2' }]);
  });

  it('flushes a trailing event when the stream ends without a blank line', () => {
    const parser = new SseParser();
    parser.push('id: 2-0\ndata: tail');
    const messages = parser.flush();

    expect(messages).toEqual([{ id: '2-0', data: 'tail' }]);
  });
});

describe('streamEvents', () => {
  it('reads an SSE body and reports messages', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('id: 1-0\nevent: notification\n'));
        controller.enqueue(encoder.encode('data: {"a":1}\n\n'));
        controller.close();
      },
    });

    const fetchImpl = async (): Promise<Response> =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });

    const messages: SseMessage[] = [];
    let opened = false;

    await streamEvents({
      url: 'http://localhost/api/v1/in-app/stream',
      headers: {},
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as typeof fetch,
      onOpen: () => {
        opened = true;
      },
      onMessage: (message) => messages.push(message),
    });

    expect(opened).toBe(true);
    expect(messages).toEqual([{ id: '1-0', event: 'notification', data: '{"a":1}' }]);
  });

  it('maps abort to a typed aborted error', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchImpl = async (): Promise<Response> => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    };

    await expect(
      streamEvents({
        url: 'http://localhost/api/v1/in-app/stream',
        headers: {},
        signal: controller.signal,
        fetchImpl: fetchImpl as typeof fetch,
        onOpen: () => undefined,
        onMessage: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
