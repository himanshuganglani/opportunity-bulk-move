import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BulkMoveWorkerModule } from './opportunities/bulk-moves/worker/bulk-move-worker.module';
import { BulkMoveWorker } from './opportunities/bulk-moves/worker/bulk-move-worker.service';

async function bootstrap(): Promise<void> {
  process.env.POSTGRES_POOL_MAX ??= '2';
  const app = await NestFactory.createApplicationContext(BulkMoveWorkerModule, {
    bufferLogs: true,
  });
  const worker = app.get(BulkMoveWorker);
  const logger = new Logger('BulkMoveWorkerProcess');
  const stop = (): void => worker.stop();

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  logger.log('Bulk move worker process started');
  await worker.run();
  await app.close();
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('BulkMoveWorkerProcess');
  logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
  );
  process.exitCode = 1;
});
