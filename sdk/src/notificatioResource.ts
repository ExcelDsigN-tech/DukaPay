// sdk/src/resources.ts (sketch; adapt to the AgentsResource pattern)

export interface NotificationEvent<T = unknown> {
  id?: string;
  event: string;      // "message" when the frame has no event: field
  data: T | string;   // parsed JSON if possible, raw text otherwise
}

export class NotificationsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly getBaseUrl: () => string,
    private readonly getToken: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  list(params: { limit?: number; cursor?: string; unread?: boolean } = {}) {
    return this.http.request<NotificationList>('GET', '/notifications', undefined, { query: params });
  }

  getPreferences() {
    return this.http.request<NotificationPreferences>('GET', '/notifications/preferences');
  }

  updatePreferences(prefs: NotificationPreferences) {
    return this.http.request<NotificationPreferences>('PUT', '/notifications/preferences', prefs);
  }

  markRead(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new DukaPayError({ message: 'ids must be a non-empty array' });
    }
    return this.http.request('POST', '/notifications/mark-read', { ids });
  }

  markAllRead() {
    return this.http.request('POST', '/notifications/mark-all-read', {});
  }

  /** Resolves when the stream ends or `signal` aborts. Not retried automatically. */
  async stream(
    onEvent: (e: NotificationEvent) => void,
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const token = this.getToken();
    const res = await this.fetchImpl(`${this.getBaseUrl()}/notifications/stream`, {
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new DukaPayError({ message: `Stream failed (${res.status})`, status: res.status });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const evt = parseSseFrame(frame);
          if (evt) onEvent(evt);
        }
      }
    } catch (err) {
      if (opts.signal?.aborted) return; // caller cancelled: not an error
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}

export function parseSseFrame(frame: string): NotificationEvent | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or comment/heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const val = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = val;
    else if (field === 'id') id = val;
    else if (field === 'data') data.push(val);
  }
  if (data.length === 0) return null; // heartbeat-only frame
  const raw = data.join('\n');
  let parsed: unknown = raw;
  try { parsed = JSON.parse(raw); } catch { /* keep raw text */ }
  return { id, event, data: parsed };
}
