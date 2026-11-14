import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AppLogger } from '../logging/app-logger';
import { POSTGRES_POOL } from './postgres.constants';

@Injectable()
export class PostgresPoolLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly logger: AppLogger,
  ) {
    this.pool.on('error', (error: Error) => {
      this.logger.error(
        'Idle PostgreSQL client encountered an error',
        error.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
