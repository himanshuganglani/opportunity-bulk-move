import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { BulkMoveItemOutcome } from './model.types';

@Table({
  tableName: 'bulk_move_items',
  timestamps: false,
  underscored: true,
})
export class BulkMoveItem extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'job_id' })
  declare jobId: string;

  @PrimaryKey
  @Column({ type: DataType.UUID, field: 'opportunity_id' })
  declare opportunityId: string;

  @Column({ type: DataType.UUID, field: 'workspace_id' })
  declare workspaceId: string;

  @Column({ type: DataType.UUID, field: 'pipeline_id' })
  declare pipelineId: string;

  @Column({ type: DataType.UUID, field: 'snapshot_stage_id' })
  declare snapshotStageId: string;

  @Column({ type: DataType.BIGINT, field: 'snapshot_stage_revision' })
  declare snapshotStageRevision: string;

  @Default('pending')
  @Column(DataType.STRING)
  declare outcome: BulkMoveItemOutcome;

  @Column({ type: DataType.DATE, field: 'processed_at' })
  declare processedAt: Date | null;

  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;
}
