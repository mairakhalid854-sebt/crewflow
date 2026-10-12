import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

const requestedPort = Number(process.env.API_PORT ?? 3001);

if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 1 ||
  requestedPort > 65_535
) {
  throw new Error('API_PORT must be an integer between 1 and 65535');
}

const app = await NestFactory.create(AppModule, { abortOnError: true });
app.enableShutdownHooks();
await app.listen(requestedPort);
