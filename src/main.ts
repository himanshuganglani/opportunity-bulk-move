import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Opportunity Bulk Move API')
    .setDescription(
      'Tenant-scoped opportunity and bulk stage move endpoints. X-Workspace-Id selects workspace context and is not authentication.',
    )
    .setVersion('1.0.0')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, openApiDocument, {
    jsonDocumentUrl: 'api/docs-json',
  });
  await app.listen(configuration.port);
}
void bootstrap();
