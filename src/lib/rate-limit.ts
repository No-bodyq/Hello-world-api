import { verifyToken } from './auth';

export type RateLimitScope = 'idea-creation' | 'idea-vote';

export type RateLimitConfig = {
  scope: RateLimitScope;
  limit: number;
  windowMs: number;
};

export type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  key: string;
};

export type RateLimitRequest = {
  headers: Headers;
  cookies?: { get(name: string): { value?: string } | undefined };
  ip?: string | null;
};

const buckets = new Map<string, number[]>();

export const RATE_LIMITS: Record<RateLimitScope, RateLimitConfig> = {
  'idea-creation': {
    scope: 'idea-creation',
    limit: 10,
    windowMs: 60 * 60 * 1000,
  },
  'idea-vote': {
    scope: 'idea-vote',
    limit: 100,
    windowMs: 60 * 60 * 1000,
  },
};

export function getRequestActorKey(request: RateLimitRequest): string {
  const token =
    request.headers.get('authorization')?.replace('Bearer ', '') ||
    request.cookies?.get('auth-token')?.value;
  const payload = token ? verifyToken(token) : null;

  if (payload?.userId) {
    return `user:${payload.userId}`;
  }

  const forwardedFor = request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  return `ip:${forwardedFor || request.ip || 'anonymous'}`;
}

export function evaluateRateLimit(
  request: RateLimitRequest,
  config: RateLimitConfig,
): RateLimitState {
  const now = Date.now();
  const key = `${config.scope}:${getRequestActorKey(request)}`;
  const windowStart = now - config.windowMs;
  const timestamps = (buckets.get(key) || []).filter(
    (timestamp) => timestamp > windowStart,
  );

  if (timestamps.length >= config.limit) {
    const resetAt = timestamps[0] + config.windowMs;
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      key,
    };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);

  const resetAt = timestamps[0] + config.windowMs;
  return {
    allowed: true,
    limit: config.limit,
    remaining: Math.max(0, config.limit - timestamps.length),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    key,
  };
}

export function addRateLimitHeaders(
  response: { headers: Headers },
  state: RateLimitState,
): { headers: Headers } {
  response.headers.set('X-RateLimit-Limit', String(state.limit));
  response.headers.set('X-RateLimit-Remaining', String(state.remaining));
  response.headers.set(
    'X-RateLimit-Reset',
    String(Math.ceil(state.resetAt / 1000)),
  );
  response.headers.set('RateLimit-Limit', String(state.limit));
  response.headers.set('RateLimit-Remaining', String(state.remaining));
  response.headers.set(
    'RateLimit-Reset',
    String(Math.ceil(state.resetAt / 1000)),
  );

  if (!state.allowed) {
    response.headers.set('Retry-After', String(state.retryAfterSeconds));
  }

  return response;
}

export function buildRateLimitResponse(
  message: string,
  state: RateLimitState,
  scope: RateLimitScope,
): Response {
  const backoffMs = getBackoffDelayMs(state.retryAfterSeconds);
  const response = new Response(
    JSON.stringify({
      error: message,
      scope,
      retryAfterSeconds: state.retryAfterSeconds,
      backoffMs,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  return addRateLimitHeaders(response, state);
}

export function getBackoffDelayMs(
  retryAfterSeconds: number,
  attempt = 1,
): number {
  const exponentialDelay = Math.min(
    60_000,
    500 * 2 ** Math.max(0, attempt - 1),
  );
  return Math.max(retryAfterSeconds * 1000, exponentialDelay);
}
