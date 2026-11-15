import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  tableName: 'stage_transitions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
})
export class StageTransition extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, field: 'workspace_id' })
  declare workspaceId: string;

  @Column({ type: DataType.UUID, field: 'pipeline_id' })
  declare pipelineId: string;

  @Column({ type: DataType.UUID, field: 'opportunity_id' })
  declare opportunityId: string;

  @Column({ type: DataType.UUID, field: 'from_stage_id' })
  declare fromStageId: string;

  @Column({ type: DataType.UUID, field: 'to_stage_id' })
  declare toStageId: string;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;
}
