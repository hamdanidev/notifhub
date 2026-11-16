import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Request-scoped correlation context.
 *
 * Every log line and every enqueued job carries the same requestId, which is generated
 * per ingest request (or taken from the inbound X-Request-ID header).
 */
export const RequestContext = {
  run<T>(requestId: string, callback: () => T): T {
    return storage.run({ requestId }, callback);
  },

  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  getStore(): RequestContextStore | undefined {
    return storage.getStore();
  },
};
