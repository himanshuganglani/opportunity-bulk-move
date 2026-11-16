import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  BulkMoveJobStatus,
  OpportunityStatus,
} from '../../common/models/model.types';
import {
  BULK_MOVE_JOB_STATUSES,
  OPPORTUNITY_STATUSES,
} from '../../common/models/model.types';

export class BulkMoveFilters {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Match opportunities currently in this stage.',
  })
  stageId?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Match the exact owner identifier.',
    example: 'owner-1',
  })
  ownerId?: string;

  @ApiPropertyOptional({
    enum: OPPORTUNITY_STATUSES,
  })
  status?: OpportunityStatus;

  @ApiPropertyOptional({
    oneOf: [
      {
        type: 'string',
        pattern: '^-?(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$',
        example: '100.00',
      },
      {
        type: 'number',
        example: 100,
      },
    ],
    description:
      'Inclusive minimum monetary value. Accepts a JSON string or number, with at most 16 integer and 2 fractional digits.',
  })
  minValue?: number | string;

  @ApiPropertyOptional({
    oneOf: [
      {
        type: 'string',
        pattern: '^-?(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$',
        example: '5000.00',
      },
      {
        type: 'number',
        example: 5000,
      },
    ],
    description:
      'Inclusive maximum monetary value. Accepts a JSON string or number, with at most 16 integer and 2 fractional digits.',
  })
  maxValue?: number | string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'date-time',
    pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$',
    description:
      'Inclusive lower creation-time bound. Must be a valid UTC timestamp.',
    example: '2026-01-01T00:00:00Z',
  })
  createdFrom?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'date-time',
    pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?Z$',
    description:
      'Exclusive upper creation-time bound. Must be a valid UTC timestamp.',
    example: '2026-02-01T00:00:00Z',
  })
  createdTo?: string;
}

export class SubmitBulkMoveInput {
  @ApiProperty({
    format: 'uuid',
    description: 'Destination stage in this workspace and pipeline.',
  })
  destinationStageId!: string;

  @ApiPropertyOptional({
    type: BulkMoveFilters,
    description:
      'Optional opportunity filters. Filter fields are combined with AND.',
  })
  filters?: BulkMoveFilters;
}

export class BulkMoveSubmission {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ enum: BULK_MOVE_JOB_STATUSES })
  status!: BulkMoveJobStatus;
}

export class BulkMoveProgress {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ enum: BULK_MOVE_JOB_STATUSES })
  status!: BulkMoveJobStatus;

  @ApiProperty({ type: 'integer', minimum: 0 })
  snapshotCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  movedCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  skippedConflictCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  skippedAlreadyAtDestinationCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  pendingCount!: number;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: 'Timestamp of the last persisted worker heartbeat, if any.',
  })
  heartbeatAt!: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Failure reason when the job has failed, if any.',
  })
  failureReason!: string | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Last recorded worker error, if any.',
  })
  lastError!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
  })
  completedAt!: string | null;
}

export interface NormalizedBulkMoveFilters {
  stageId: string | null;
  ownerId: string | null;
  status: OpportunityStatus | null;
  minValue: string | null;
  maxValue: string | null;
  createdFrom: string | null;
  createdTo: string | null;
}
