import { ApiProperty } from '@nestjs/swagger';
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from '../common/models/model.types';

export { OPPORTUNITY_STATUSES } from '../common/models/model.types';
export type { OpportunityStatus } from '../common/models/model.types';

export class CreateOpportunityInput {
  @ApiProperty({
    description: 'Opportunity name. Must contain non-whitespace text.',
    maxLength: 255,
    example: 'Example opportunity',
  })
  name!: string;

  @ApiProperty({
    description:
      'Monetary amount as a decimal with at most 16 integer and 2 fractional digits. The API accepts a JSON string or number.',
    oneOf: [
      {
        type: 'string',
        pattern: '^-?(?:0|[1-9]\\d{0,15})(?:\\.\\d{1,2})?$',
        example: '1250.00',
      },
      {
        type: 'number',
        example: 1250,
      },
    ],
  })
  value!: number | string;

  @ApiProperty({
    enum: OPPORTUNITY_STATUSES,
    example: 'open',
  })
  status!: OpportunityStatus;

  @ApiProperty({
    description: 'Owner identifier. Must contain non-whitespace text.',
    maxLength: 255,
    example: 'owner-1',
  })
  ownerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Stage must belong to this workspace and pipeline.',
  })
  stageId!: string;
}

export class MoveOpportunityInput {
  @ApiProperty({
    format: 'uuid',
    description:
      'Destination stage ID must belong to this workspace and pipeline. For the seeded main pipeline, Contacted is 53ce639f-a428-3663-ecbd-721ca10e970d.',
    example: '53ce639f-a428-3663-ecbd-721ca10e970d',
  })
  stageId!: string;
}

export class OpportunityRecord {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid' })
  pipelineId!: string;

  @ApiProperty({ format: 'uuid' })
  stageId!: string;

  @ApiProperty({ example: 'Example opportunity' })
  name!: string;

  @ApiProperty({ type: 'string', example: '1250.00' })
  value!: string;

  @ApiProperty({ enum: OPPORTUNITY_STATUSES })
  status!: OpportunityStatus;

  @ApiProperty({ example: 'owner-1' })
  ownerId!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  stageRevision!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class OpportunityPage {
  @ApiProperty({ type: [OpportunityRecord] })
  data!: OpportunityRecord[];

  @ApiProperty({
    type: 'string',
    nullable: true,
    description:
      'Opaque cursor for the next page; null when there is no next page.',
  })
  nextCursor!: string | null;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, example: 50 })
  limit!: number;
}
