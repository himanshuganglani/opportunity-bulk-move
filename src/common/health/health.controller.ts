import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { AppLogger } from '../logging/app-logger';
import { POSTGRES_POOL } from '../postgres/postgres.constants';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly logger: AppLogger,
  ) {}

  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get(['', 'ready'])
  async readiness(): Promise<{
    status: 'ok';
    dependencies: { postgres: 'up' };
  }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', dependencies: { postgres: 'up' } };
    } catch (error) {
      this.logger.error(
        'PostgreSQL readiness check failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException({
        status: 'error',
        dependencies: { postgres: 'down' },
      });
    }
  }
}
