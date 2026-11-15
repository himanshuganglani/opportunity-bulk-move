import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { PostgresModule } from './postgres/postgres.module';

@Module({
  imports: [LoggingModule, PostgresModule, DatabaseModule, HealthModule],
  exports: [LoggingModule, PostgresModule, DatabaseModule, HealthModule],
})
export class CommonModule {}
