import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.dto';
import { UuidFormatPipe } from '../../common/pipes/uuid-format.pipe';
import type { WorkspaceRequest } from '../../common/middleware/workspace.middleware';
import { BulkMovesService } from './bulk-moves.service';
import {
  BulkMoveProgress,
  BulkMoveSubmission,
  SubmitBulkMoveInput,
} from './bulk-moves.types';

@Controller('pipelines/:pipelineId/opportunity-bulk-moves')
@ApiTags('Bulk Moves')
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description:
    'Workspace context for tenant scoping. This header is not an authentication mechanism.',
  schema: { type: 'string', format: 'uuid' },
})
export class BulkMovesController {
  constructor(private readonly bulkMovesService: BulkMovesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a bulk stage move',
    description:
      'Accepts a job to move at most 50,000 opportunities and returns immediately. Matching opportunities are materialized into a durable snapshot at submission time; later changes to the filter do not add records to or remove records from that snapshot. Poll the returned job ID at GET /pipelines/{pipelineId}/opportunity-bulk-moves/{jobId}. The request is idempotent for a workspace and Idempotency-Key when its normalized payload is unchanged.',
  })
  @ApiParam({ name: 'pipelineId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Non-empty key of at most 255 characters. Reusing the key with a different normalized payload returns 422.',
    schema: { type: 'string', maxLength: 255 },
  })
  @ApiAcceptedResponse({
    description: 'The accepted job handle. Use jobId to poll progress.',
    type: BulkMoveSubmission,
  })
  @ApiBadRequestResponse({
    description:
      'Missing/invalid workspace or idempotency header, pipeline ID, destination stage ID, or filter.',
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description:
      'The destination stage or filtered source stage was not found in this workspace and pipeline.',
    type: ApiErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The idempotency key was reused with a different request, or the snapshot exceeds 50,000 matching opportunities.',
    type: ApiErrorResponse,
  })
  submit(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new UuidFormatPipe('pipelineId'))
    pipelineId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: SubmitBulkMoveInput,
  ): Promise<BulkMoveSubmission> {
    return this.bulkMovesService.submit(
      request.workspaceId,
      pipelineId,
      idempotencyKey,
      input,
    );
  }

  @Get(':jobId')
  @ApiOperation({
    summary: 'Get bulk move job progress',
    description:
      'Returns persisted status and outcome counts for a job scoped to this workspace and pipeline.',
  })
  @ApiParam({ name: 'pipelineId', format: 'uuid' })
  @ApiParam({
    name: 'jobId',
    format: 'uuid',
    description: 'Job ID returned by bulk move submission.',
  })
  @ApiOkResponse({
    description: 'Current persisted job status and progress.',
    type: BulkMoveProgress,
  })
  @ApiBadRequestResponse({
    description: 'Missing/invalid workspace header or path UUID.',
    type: ApiErrorResponse,
  })
  @ApiNotFoundResponse({
    description:
      'The job was not found in this workspace and pipeline. This also applies to cross-workspace access.',
    type: ApiErrorResponse,
  })
  @ApiResponse({
    status: 500,
    description: 'An unexpected server or database error occurred.',
    type: ApiErrorResponse,
  })
  getProgress(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new UuidFormatPipe('pipelineId'))
    pipelineId: string,
    @Param('jobId', new UuidFormatPipe('jobId'))
    jobId: string,
  ): Promise<BulkMoveProgress> {
    return this.bulkMovesService.getProgress(
      request.workspaceId,
      pipelineId,
      jobId,
    );
  }
}
