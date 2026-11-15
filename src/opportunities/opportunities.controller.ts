import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import type {
  CreateOpportunityInput,
  OpportunityPage,
  OpportunityRecord,
} from './opportunities.types';

@Controller('pipelines/:pipelineId/opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  create(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('pipelineId') pipelineId: string,
    @Body() input: CreateOpportunityInput,
  ): Promise<OpportunityRecord> {
    return this.opportunitiesService.create(workspaceId, pipelineId, input);
  }

  @Get()
  listByStage(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('pipelineId') pipelineId: string,
    @Query('stageId') stageId: string | undefined,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<OpportunityPage> {
    return this.opportunitiesService.listByStage(
      workspaceId,
      pipelineId,
      stageId,
      limit,
      cursor,
    );
  }
}
