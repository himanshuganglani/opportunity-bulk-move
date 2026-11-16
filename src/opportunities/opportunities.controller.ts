import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { WorkspaceRequest } from '../common/middleware/workspace.middleware';
import { OpportunitiesService } from './opportunities.service';
import type {
  CreateOpportunityInput,
  MoveOpportunityInput,
  OpportunityPage,
  OpportunityRecord,
} from './opportunities.types';

@Controller('pipelines/:pipelineId/opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  create(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new ParseUUIDPipe({ version: 'all' }))
    pipelineId: string,
    @Body() input: CreateOpportunityInput,
  ): Promise<OpportunityRecord> {
    return this.opportunitiesService.create(
      request.workspaceId,
      pipelineId,
      input,
    );
  }

  @Patch(':opportunityId/stage')
  moveStage(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new ParseUUIDPipe({ version: 'all' }))
    pipelineId: string,
    @Param('opportunityId', new ParseUUIDPipe({ version: 'all' }))
    opportunityId: string,
    @Body() input: MoveOpportunityInput,
  ): Promise<OpportunityRecord> {
    return this.opportunitiesService.moveStage(
      request.workspaceId,
      pipelineId,
      opportunityId,
      input,
    );
  }

  @Get()
  listByStage(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new ParseUUIDPipe({ version: 'all' }))
    pipelineId: string,
    @Query('stageId') stageId: string | undefined,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<OpportunityPage> {
    return this.opportunitiesService.listByStage(
      request.workspaceId,
      pipelineId,
      stageId,
      limit,
      cursor,
    );
  }
}
