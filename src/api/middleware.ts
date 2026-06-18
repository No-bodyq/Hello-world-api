import { buildCORSHeaders } from '../api/lib/cors';
import { addSecurityHeaders } from '../api/middleware/security';
import {
  RATE_LIMITS,
  addRateLimitHeaders,
  buildRateLimitResponse,
  evaluateRateLimit,
} from '../lib/rate-limit';

type MiddlewareRequest = Request & {
  nextUrl?: URL;
  cookies?: { get(name: string): { value?: string } | undefined };
  ip?: string | null;
};

function getPathname(request: MiddlewareRequest): string {
  return request.nextUrl?.pathname ?? new URL(request.url).pathname;
}

function getMatchedLimit(request: MiddlewareRequest) {
  const pathname = getPathname(request);

  if (pathname === '/api/ideas' && request.method === 'POST') {
    return RATE_LIMITS['idea-creation'];
  }

  if (
    /^\/api\/ideas\/[^/]+\/vote$/.test(pathname) &&
    request.method === 'POST'
  ) {
    return RATE_LIMITS['idea-vote'];
  }

  return null;
}

function createResponse(status = 200, body?: BodyInit | null): Response {
  return new Response(body, { status });
}

function applyCommonHeaders(response: Response, origin?: string): Response {
  const corsHeaders = buildCORSHeaders(origin);

  Object.entries(corsHeaders).forEach(([key, value]) =>
    response.headers.set(key, value),
  );
  addSecurityHeaders(response);

  return response;
}

export async function middleware(request: MiddlewareRequest) {
  const origin = request.headers.get('origin') || undefined;

  if (request.method === 'OPTIONS') {
    return applyCommonHeaders(createResponse(204), origin);
  }

  const matchedLimit = getMatchedLimit(request);

  if (matchedLimit) {
    const state = evaluateRateLimit(request, matchedLimit);
    const pathname = getPathname(request);

    if (!state.allowed) {
      console.warn('Rate limit violation', {
        scope: matchedLimit.scope,
        path: pathname,
        method: request.method,
        key: state.key,
        retryAfterSeconds: state.retryAfterSeconds,
      });

      return applyCommonHeaders(
        buildRateLimitResponse(
          matchedLimit.scope === 'idea-creation'
            ? 'Too many idea creations. Please try again later.'
            : 'Too many votes. Please slow down and retry later.',
          state,
          matchedLimit.scope,
        ),
        origin,
      );
    }

    const response = createResponse();
    addRateLimitHeaders(response, state);
    return applyCommonHeaders(response, origin);
  }

  return applyCommonHeaders(createResponse(), origin);
}
