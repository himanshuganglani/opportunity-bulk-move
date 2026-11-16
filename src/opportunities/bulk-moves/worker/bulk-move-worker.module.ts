import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../common/database/database.module';
import { ConfigurationModule } from '../../../config/configuration.module';
import { BulkMoveWorker } from './bulk-move-worker.service';

@Module({
  imports: [ConfigurationModule, DatabaseModule],
  providers: [BulkMoveWorker],
  exports: [BulkMoveWorker],
})
export class BulkMoveWorkerModule {}
