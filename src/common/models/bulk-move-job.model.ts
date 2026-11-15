import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { BulkMoveJobStatus } from './model.types';

@Table({
  tableName: 'bulk_move_jobs',
  timestamps: true,
  underscored: true,
})
export class BulkMoveJob extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, field: 'workspace_id' })
  declare workspaceId: string;

  @Column({ type: DataType.UUID, field: 'pipeline_id' })
  declare pipelineId: string;

  @Column({ type: DataType.UUID, field: 'destination_stage_id' })
  declare destinationStageId: string;

  @Column({ type: DataType.STRING, field: 'idempotency_key' })
  declare idempotencyKey: string;

  @Column({ type: DataType.CHAR(64), field: 'request_hash' })
  declare requestHash: string;

  @Column(DataType.JSONB)
  declare filters: Record<string, unknown>;

  @Default('queued')
  @Column(DataType.STRING)
  declare status: BulkMoveJobStatus;

  @Column({ type: DataType.STRING, field: 'failure_reason' })
  declare failureReason: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, field: 'snapshot_count' })
  declare snapshotCount: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, field: 'moved_count' })
  declare movedCount: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, field: 'skipped_conflict_count' })
  declare skippedConflictCount: number;

  @Default(0)
  @Column({
    type: DataType.INTEGER,
    field: 'skipped_already_at_destination_count',
  })
  declare skippedAlreadyAtDestinationCount: number;

  @Column({ type: DataType.STRING, field: 'lease_owner' })
  declare leaseOwner: string | null;

  @Default(0)
  @Column({ type: DataType.BIGINT, field: 'lease_generation' })
  declare leaseGeneration: string;

  @Column({ type: DataType.DATE, field: 'lease_expires_at' })
  declare leaseExpiresAt: Date | null;

  @Column({ type: DataType.DATE, field: 'heartbeat_at' })
  declare heartbeatAt: Date | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, field: 'attempt_count' })
  declare attemptCount: number;

  @Column({ type: DataType.DATE, field: 'next_attempt_at' })
  declare nextAttemptAt: Date | null;

  @Column({ type: DataType.TEXT, field: 'last_error' })
  declare lastError: string | null;

  @Column({ type: DataType.DATE, field: 'completed_at' })
  declare completedAt: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;
}
