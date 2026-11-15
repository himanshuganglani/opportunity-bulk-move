import { Module } from '@nestjs/common';
import {
  SequelizeModule,
  type SequelizeModuleOptions,
} from '@nestjs/sequelize';
import {
  APPLICATION_CONFIGURATION,
  ConfigurationModule,
} from '../config/configuration.module';
import type { ApplicationConfiguration } from '../config/env.validation';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [APPLICATION_CONFIGURATION],
      useFactory: (
        configuration: ApplicationConfiguration,
      ): SequelizeModuleOptions => ({
        dialect: 'postgres',
        host: configuration.postgres.host,
        port: configuration.postgres.port,
        username: configuration.postgres.user,
        password: configuration.postgres.password,
        database: configuration.postgres.database,
        autoLoadModels: false,
        synchronize: false,
        logging: false,
        pool: {
          max: 9,
          min: 0,
          acquire: 30_000,
          idle: 10_000,
        },
      }),
    }),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
