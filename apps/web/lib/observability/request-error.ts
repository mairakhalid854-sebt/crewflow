type WebRequestErrorInput = {
  error: unknown;
  method: string;
  routePath: string;
  routeType: string;
  routerKind: string;
  correlationId?: string | string[];
  occurredAt?: Date;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_DIGEST_PATTERN = /^\d{6,32}$/;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SAFE_METHOD_PATTERN = /^[A-Z]{3,10}$/;
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9_./[\]-]{0,255}$/;

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return SAFE_ERROR_NAME_PATTERN.test(error.name) ? error.name : 'Error';
}

function safeErrorDigest(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) {
    return null;
  }

  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && SAFE_ERROR_DIGEST_PATTERN.test(digest)
    ? digest
    : null;
}

function safeCorrelationId(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

function safeMethod(value: string): string {
  const candidate = value.toUpperCase();
  return SAFE_METHOD_PATTERN.test(candidate) ? candidate : 'UNKNOWN';
}

function safeRoute(value: string): string {
  return SAFE_ROUTE_PATTERN.test(value) ? value : '/unknown';
}

export function createWebRequestErrorEvent(input: WebRequestErrorInput) {
  return {
    timestamp: (input.occurredAt ?? new Date()).toISOString(),
    level: 'error',
    service: 'crewflow-web',
    event: 'request_error',
    method: safeMethod(input.method),
    route: safeRoute(input.routePath),
    route_type: input.routeType,
    router_kind: input.routerKind,
    correlation_id: safeCorrelationId(input.correlationId),
    error_name: safeErrorName(input.error),
    error_digest: safeErrorDigest(input.error),
  } as const;
}
