import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { DatabaseModule } from '../common/database/database.module';
import { WorkspaceMiddleware } from '../common/middleware/workspace.middleware';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { Opportunity } from '../common/models/opportunity.model';
import { Stage } from '../common/models/stage.model';
import { StageTransition } from '../common/models/stage-transition.model';

@Module({
  imports: [
    DatabaseModule,
    SequelizeModule.forFeature([Stage, Opportunity, StageTransition]),
  ],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, WorkspaceMiddleware],
})
export class OpportunitiesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(WorkspaceMiddleware).forRoutes(OpportunitiesController);
  }
}
