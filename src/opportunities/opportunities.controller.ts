import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/swagger/api-error-response.dto';
import { UuidFormatPipe } from '../common/pipes/uuid-format.pipe';
import type { WorkspaceRequest } from '../common/middleware/workspace.middleware';
import { OpportunitiesService } from './opportunities.service';
import {
  CreateOpportunityInput,
  MoveOpportunityInput,
  OpportunityPage,
  OpportunityRecord,
} from './opportunities.types';

@Controller('pipelines/:pipelineId/opportunities')
@ApiTags('Opportunities')
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description:
    'Workspace context for tenant scoping. This header is not an authentication mechanism.',
  schema: { type: 'string', format: 'uuid' },
})
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an opportunity',
    description:
      'Creates an opportunity in the specified pipeline stage. The stage must belong to the supplied workspace and pipeline.',
  })
  @ApiParam({ name: 'pipelineId', format: 'uuid' })
  @ApiCreatedResponse({
    description: 'The created opportunity.',
    type: OpportunityRecord,
  })
  @ApiBadRequestResponse({
    description:
      'Missing/invalid workspace header, pipeline ID, or request fields.',
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'The pipeline or stage was not found in this workspace.',
    type: ApiErrorResponse,
  })
  create(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new UuidFormatPipe('pipelineId'))
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
  @ApiOperation({
    summary: 'Move an opportunity to another stage',
    description:
      'Moves one opportunity to a stage in the same workspace and pipeline. The stage update and transition history entry are committed together; moving to the current stage is a no-op.',
  })
  @ApiParam({ name: 'pipelineId', format: 'uuid' })
  @ApiParam({ name: 'opportunityId', format: 'uuid' })
  @ApiOkResponse({
    description:
      'The opportunity after the requested move (or unchanged for a no-op).',
    type: OpportunityRecord,
  })
  @ApiBadRequestResponse({
    description:
      'Missing/invalid workspace header, path UUID, or destination stage ID.',
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description:
      'Destination stage not found in workspace and pipeline, or opportunity not found in workspace.',
    type: ApiErrorResponse,
  })
  moveStage(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new UuidFormatPipe('pipelineId'))
    pipelineId: string,
    @Param('opportunityId', new UuidFormatPipe('opportunityId'))
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
  @ApiOperation({
    summary: 'List opportunities in a stage',
    description:
      'Returns an ascending, cursor-paginated page for the requested stage in this workspace and pipeline.',
  })
  @ApiParam({ name: 'pipelineId', format: 'uuid' })
  @ApiQuery({
    name: 'stageId',
    required: true,
    format: 'uuid',
    description: 'Stage to list; must belong to this workspace and pipeline.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 100,
    description: 'Page size; defaults to 50.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: 'string',
    description: 'Opaque cursor returned as nextCursor by the preceding page.',
  })
  @ApiOkResponse({
    description: 'The requested page.',
    type: OpportunityPage,
  })
  @ApiBadRequestResponse({
    description:
      'Missing/invalid workspace header, stage ID, limit, or cursor.',
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'The stage was not found in this workspace and pipeline.',
    type: ApiErrorResponse,
  })
  listByStage(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new UuidFormatPipe('pipelineId'))
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
