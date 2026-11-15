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
import type { OpportunityStatus } from './model.types';

@Table({
  tableName: 'opportunities',
  timestamps: true,
  underscored: true,
})
export class Opportunity extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, field: 'workspace_id' })
  declare workspaceId: string;

  @Column({ type: DataType.UUID, field: 'pipeline_id' })
  declare pipelineId: string;

  @Column({ type: DataType.UUID, field: 'stage_id' })
  declare stageId: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column(DataType.DECIMAL(18, 2))
  declare value: string;

  @Column(DataType.STRING)
  declare status: OpportunityStatus;

  @Column({ type: DataType.STRING, field: 'owner_id' })
  declare ownerId: string;

  @Default(0)
  @Column({ type: DataType.BIGINT, field: 'stage_revision' })
  declare stageRevision: string;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;
}
