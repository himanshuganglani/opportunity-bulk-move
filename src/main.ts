import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './common/logging/app-logger';
import { APPLICATION_CONFIGURATION } from './config/configuration.module';
import type { ApplicationConfiguration } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
  const configuration = app.get<ApplicationConfiguration>(
    APPLICATION_CONFIGURATION,
  );
  await app.listen(configuration.port);
}
void bootstrap();
