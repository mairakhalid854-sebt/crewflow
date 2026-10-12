import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  readonly service: 'crewflow-api';
  readonly status: 'ok';
  readonly version: 'v1';
}

@Controller('v1/health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: 'crewflow-api',
      status: 'ok',
      version: 'v1',
    };
  }
}
