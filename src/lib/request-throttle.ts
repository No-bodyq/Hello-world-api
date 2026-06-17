export interface ThrottleOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');

  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  const dateValue = Date.parse(retryAfter);
  if (!Number.isNaN(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

export async function requestWithBackoff(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ThrottleOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(input, init);

    if (response.status !== 429 || attempt === maxRetries) {
      return response;
    }

    const retryAfter = parseRetryAfter(response);
    const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jitter = Math.round(exponentialDelay * 0.2 * Math.random());
    await delay(Math.max(retryAfter ?? 0, exponentialDelay + jitter));
  }

  return fetch(input, init);
}

export function createClientThrottler(minIntervalMs: number) {
  let lastRunAt = 0;
  const queue: Array<() => void> = [];
  let running = false;

  const drain = async () => {
    if (running) {
      return;
    }

    running = true;

    while (queue.length > 0) {
      const waitMs = Math.max(0, lastRunAt + minIntervalMs - Date.now());
      if (waitMs > 0) {
        await delay(waitMs);
      }

      lastRunAt = Date.now();
      const next = queue.shift();
      next?.();
    }

    running = false;
  };

  return function throttle<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve).catch(reject);
      });

      void drain();
    });
  };
}
