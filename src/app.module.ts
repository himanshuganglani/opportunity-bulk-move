import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { ConfigurationModule } from './config/configuration.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [ConfigurationModule, DatabaseModule, CommonModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
