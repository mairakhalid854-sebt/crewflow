import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { HealthController } from './health.controller.js';
import { parseRateLimitConfiguration } from './runtime/rate-limit.config.js';
import { RequestContextMiddleware } from './runtime/request-context.middleware.js';

const rateLimit = parseRateLimitConfiguration(process.env);

@Module({
  controllers: [HealthController],
  imports: [ThrottlerModule.forRoot([rateLimit])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: '{*splat}',
    });
  }
}
