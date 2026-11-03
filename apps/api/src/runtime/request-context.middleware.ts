import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const CORRELATION_HEADER = 'x-correlation-id';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveCorrelationId(value: string | undefined): string {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : randomUUID();
}

export function requestPath(originalUrl: string): string {
  return originalUrl.split('?', 1)[0] || '/';
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(
      request.header(CORRELATION_HEADER),
    );
    const startedAt = process.hrtime.bigint();

    request.headers[CORRELATION_HEADER] = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.once('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const fields = {
        correlationId,
        durationMs: Math.round(durationMs * 100) / 100,
        method: request.method,
        path: requestPath(request.originalUrl),
        statusCode: response.statusCode,
      };

      if (response.statusCode >= 500) {
        this.logger.error('request.completed', fields);
      } else if (response.statusCode >= 400) {
        this.logger.warn('request.completed', fields);
      } else {
        this.logger.log('request.completed', fields);
      }
    });

    next();
  }
}
