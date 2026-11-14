import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { PostgresModule } from './postgres/postgres.module';

@Module({
  imports: [LoggingModule, PostgresModule, HealthModule],
  exports: [LoggingModule, PostgresModule, HealthModule],
})
export class CommonModule {}
