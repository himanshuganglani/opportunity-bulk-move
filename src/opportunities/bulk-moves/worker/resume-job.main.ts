import { BadRequestException, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BulkMoveWorkerModule } from './bulk-move-worker.module';
import { BulkMoveWorker } from './bulk-move-worker.service';

async function bootstrap(): Promise<void> {
  process.env.POSTGRES_POOL_MAX ??= '2';
  const [option, jobId, ...extraArguments] = process.argv.slice(2);
  if (
    option !== '--job-id' ||
    !jobId ||
    extraArguments.length > 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  ) {
    throw new BadRequestException(
      'Usage: npm run jobs:resume -- --job-id <uuid>',
    );
  }

  const app = await NestFactory.createApplicationContext(BulkMoveWorkerModule, {
    bufferLogs: true,
  });
  try {
    await app.get(BulkMoveWorker).resumeJob(jobId.toLowerCase());
    new Logger('BulkMoveResume').log(`Resumed pending items for job ${jobId}`);
  } finally {
    await app.close();
  }
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('BulkMoveResume');
  logger.error(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
  );
  process.exitCode = 1;
});
