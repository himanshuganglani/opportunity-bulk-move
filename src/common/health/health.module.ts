import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { PostgresModule } from '../postgres/postgres.module';
import { HealthController } from './health.controller';

@Module({
  imports: [LoggingModule, PostgresModule],
  controllers: [HealthController],
})
export class HealthModule {}
