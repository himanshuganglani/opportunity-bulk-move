import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import {
  APPLICATION_CONFIGURATION,
  ConfigurationModule,
} from '../../config/configuration.module';
import type { ApplicationConfiguration } from '../../config/env.validation';
import { LoggingModule } from '../logging/logging.module';
import { POSTGRES_POOL } from './postgres.constants';
import { PostgresPoolLifecycle } from './postgres-pool-lifecycle';

@Module({
  imports: [ConfigurationModule, LoggingModule],
  providers: [
    {
      provide: POSTGRES_POOL,
      inject: [APPLICATION_CONFIGURATION],
      useFactory: (configuration: ApplicationConfiguration) =>
        new Pool({
          ...configuration.postgres,
          max: 10,
          connectionTimeoutMillis: 5_000,
        }),
    },
    PostgresPoolLifecycle,
  ],
  exports: [POSTGRES_POOL],
})
export class PostgresModule {}
