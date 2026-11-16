import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { WorkspaceRequest } from '../../common/middleware/workspace.middleware';
import { BulkMovesService } from './bulk-moves.service';
import type {
  BulkMoveProgress,
  BulkMoveSubmission,
  SubmitBulkMoveInput,
} from './bulk-moves.types';

@Controller('pipelines/:pipelineId/opportunity-bulk-moves')
export class BulkMovesController {
  constructor(private readonly bulkMovesService: BulkMovesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new ParseUUIDPipe({ version: 'all' }))
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
  getProgress(
    @Req() request: WorkspaceRequest,
    @Param('pipelineId', new ParseUUIDPipe({ version: 'all' }))
    pipelineId: string,
    @Param('jobId', new ParseUUIDPipe({ version: 'all' }))
    jobId: string,
  ): Promise<BulkMoveProgress> {
    return this.bulkMovesService.getProgress(
      request.workspaceId,
      pipelineId,
      jobId,
    );
  }
}
