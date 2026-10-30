/** Read-only searches only: never retry email sends or other writes. */
export class SearchRequestError extends Error {
  constructor(public status: number | null, public attempts: number, public retryAfterMs = 0) {
    super(status === null ? "Search connection timed out or failed" : `Search returned ${status}`);
  }
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export async function fetchSearchText(url: string | URL, init: RequestInit, onRetry: (attempt: number) => void = () => {}) {
  const deadline = Date.now() + 25_000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let failure: SearchRequestError;
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(7_000, deadline - Date.now()))) });
      if (response.ok) return await response.text();
      const after = retryAfterMs(response.headers.get("Retry-After"));
      await response.body?.cancel();
      failure = new SearchRequestError(response.status, attempt, after);
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw failure;
    } catch (error) {
      failure = error instanceof SearchRequestError ? error : new SearchRequestError(null, attempt);
      if (failure.status !== null && ![408, 429, 500, 502, 503, 504].includes(failure.status)) throw failure;
    }
    const delay = Math.max(failure.retryAfterMs, 1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    // Do not ignore a provider's long cooldown or keep a scheduled call waiting indefinitely.
    if (attempt === 3 || Date.now() + delay + 1_000 >= deadline) throw failure;
    onRetry(attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new SearchRequestError(null, 3);
}