import 'dotenv/config';
import { Module } from '@nestjs/common';
import { validateEnvironment } from './env.validation';

export const APPLICATION_CONFIGURATION = Symbol('APPLICATION_CONFIGURATION');

@Module({
  providers: [
    {
      provide: APPLICATION_CONFIGURATION,
      useFactory: () => validateEnvironment(process.env),
    },
  ],
  exports: [APPLICATION_CONFIGURATION],
})
export class ConfigurationModule {}
