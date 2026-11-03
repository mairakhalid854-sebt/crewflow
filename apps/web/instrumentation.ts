import { createWebRequestErrorEvent } from './lib/observability/request-error';

type RequestErrorContext = Readonly<{
  routerKind: string;
  routePath: string;
  routeType: string;
}>;

type RequestSummary = Readonly<{
  method: string;
  headers: NodeJS.Dict<string | string[]>;
}>;

export function onRequestError(
  error: unknown,
  request: RequestSummary,
  context: RequestErrorContext,
) {
  const event = createWebRequestErrorEvent({
    error,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    correlationId: request.headers['x-correlation-id'],
  });

  console.error(JSON.stringify(event));
}
