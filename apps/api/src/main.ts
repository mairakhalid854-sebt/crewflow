import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
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

const productionLogger = new ConsoleLogger({
  json: process.env.NODE_ENV === 'production',
  logLevels: ['log', 'warn', 'error', 'fatal'],
});
const app = await NestFactory.create(AppModule, {
  abortOnError: true,
  logger: productionLogger,
});
app.enableShutdownHooks();
await app.listen(requestedPort);
