import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { BulkMoveJob } from '../../common/models/bulk-move-job.model';
import { OPPORTUNITY_STATUSES } from '../../common/models/model.types';
import { Stage } from '../../common/models/stage.model';
import { isUuidFormat, uuidFormatError } from '../../common/validation/uuid';
import type {
  BulkMoveFilters,
  BulkMoveProgress,
  BulkMoveSubmission,
  NormalizedBulkMoveFilters,
  SubmitBulkMoveInput,
} from './bulk-moves.types';

const MONEY_PATTERN = /^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const MAX_SNAPSHOT_SIZE = 50_000;

interface InsertedJob {
  id: string;
}

interface SnapshotCount {
  snapshot_count: number;
}

@Injectable()
export class BulkMovesService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Stage) private readonly stageModel: typeof Stage,
    @InjectModel(BulkMoveJob)
    private readonly bulkMoveJobModel: typeof BulkMoveJob,
  ) {}

  async submit(
    workspaceId: string,
    pipelineId: string,
    idempotencyKey: string | undefined,
    input: SubmitBulkMoveInput,
  ): Promise<BulkMoveSubmission> {
    const key = this.requireText(idempotencyKey, 'Idempotency-Key', 255);
    const tenantPipelineId = this.requireUuid(pipelineId, 'pipelineId');
    this.validateInputFields(input);
    const destinationStageId = this.requireUuid(
      input?.destinationStageId,
      'destinationStageId',
    );
    const filters = this.normalizeFilters(input?.filters);
    if (filters.stageId === destinationStageId) {
      throw new BadRequestException(
        'filters.stageId must differ from destinationStageId',
      );
    }
    const requestHash = this.hashRequest(
      workspaceId,
      tenantPipelineId,
      destinationStageId,
      filters,
    );

    return this.sequelize.transaction(async (transaction) => {
      const existingJob = await this.bulkMoveJobModel.findOne({
        attributes: ['id', 'requestHash', 'status'],
        where: { workspaceId, idempotencyKey: key },
        transaction,
      });
      if (existingJob) {
        if (existingJob.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            'Idempotency-Key was already used with a different request',
          );
        }
        return { jobId: existingJob.id, status: existingJob.status };
      }

      const destinationStage = await this.stageModel.findOne({
        attributes: ['id'],
        where: {
          workspaceId,
          pipelineId: tenantPipelineId,
          id: destinationStageId,
        },
        transaction,
      });
      if (!destinationStage) {
        throw new NotFoundException('Pipeline or destination stage not found');
      }

      if (filters.stageId) {
        const sourceStage = await this.stageModel.findOne({
          attributes: ['id'],
          where: {
            workspaceId,
            pipelineId: tenantPipelineId,
            id: filters.stageId,
          },
          transaction,
        });
        if (!sourceStage) {
          throw new NotFoundException('Source stage not found');
        }
      }

      const insertedJobs = await this.sequelize.query<InsertedJob>(
        `INSERT INTO bulk_move_jobs (
           workspace_id, pipeline_id, destination_stage_id,
           idempotency_key, request_hash, filters, snapshot_count
         )
         VALUES (
           :workspaceId, :pipelineId, :destinationStageId,
           :idempotencyKey, :requestHash, CAST(:filters AS jsonb), 0
         )
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
         RETURNING id`,
        {
          replacements: {
            workspaceId,
            pipelineId: tenantPipelineId,
            destinationStageId,
            idempotencyKey: key,
            requestHash,
            filters: JSON.stringify(filters),
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      );

      if (insertedJobs.length === 0) {
        const conflictingJob = await this.bulkMoveJobModel.findOne({
          attributes: ['id', 'requestHash', 'status'],
          where: { workspaceId, idempotencyKey: key },
          transaction,
        });
        if (!conflictingJob) {
          throw new Error('Idempotency conflict did not resolve to a job');
        }
        if (conflictingJob.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            'Idempotency-Key was already used with a different request',
          );
        }
        return { jobId: conflictingJob.id, status: conflictingJob.status };
      }

      const jobId = insertedJobs[0].id;
      const snapshotRows = await this.sequelize.query<SnapshotCount>(
        this.snapshotInsertSql(filters),
        {
          replacements: {
            workspaceId,
            pipelineId: tenantPipelineId,
            jobId,
            stageId: filters.stageId,
            ownerId: filters.ownerId,
            status: filters.status,
            minValue: filters.minValue,
            maxValue: filters.maxValue,
            createdFrom: filters.createdFrom,
            createdTo: filters.createdTo,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      const snapshotCount = Number(snapshotRows[0]?.snapshot_count ?? 0);

      if (snapshotCount > MAX_SNAPSHOT_SIZE) {
        throw new UnprocessableEntityException(
          `Bulk move matches more than ${MAX_SNAPSHOT_SIZE} opportunities`,
        );
      }

      const [updatedJobs] = await this.bulkMoveJobModel.update(
        { snapshotCount },
        {
          where: { id: jobId, workspaceId },
          transaction,
        },
      );
      if (updatedJobs !== 1) {
        throw new Error('Bulk move job disappeared before snapshot was saved');
      }

      return { jobId, status: 'queued' };
    });
  }

  async getProgress(
    workspaceId: string,
    pipelineId: string,
    jobId: string,
  ): Promise<BulkMoveProgress> {
    const job = await this.bulkMoveJobModel.findOne({
      attributes: [
        'id',
        'status',
        'snapshotCount',
        'movedCount',
        'skippedConflictCount',
        'skippedAlreadyAtDestinationCount',
        'heartbeatAt',
        'failureReason',
        'lastError',
        'createdAt',
        'updatedAt',
        'completedAt',
      ],
      where: { id: jobId, workspaceId, pipelineId },
    });

    if (!job) {
      throw new NotFoundException('Bulk move job not found');
    }

    const snapshotCount = Number(job.snapshotCount);
    const movedCount = Number(job.movedCount);
    const skippedConflictCount = Number(job.skippedConflictCount);
    const skippedAlreadyAtDestinationCount = Number(
      job.skippedAlreadyAtDestinationCount,
    );
    const pendingCount =
      snapshotCount -
      movedCount -
      skippedConflictCount -
      skippedAlreadyAtDestinationCount;

    if (pendingCount < 0) {
      throw new Error('Bulk move job counters exceed its snapshot count');
    }

    return {
      jobId: job.id,
      status: job.status,
      snapshotCount,
      movedCount,
      skippedConflictCount,
      skippedAlreadyAtDestinationCount,
      pendingCount,
      heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
      failureReason: job.failureReason,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  private validateInputFields(input: SubmitBulkMoveInput): void {
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (key) => key !== 'destinationStageId' && key !== 'filters',
      )
    ) {
      throw new BadRequestException('Request contains unsupported fields');
    }
  }

  private normalizeFilters(
    filters: BulkMoveFilters | undefined,
  ): NormalizedBulkMoveFilters {
    if (
      filters !== undefined &&
      (typeof filters !== 'object' ||
        filters === null ||
        Array.isArray(filters))
    ) {
      throw new BadRequestException('filters must be an object');
    }

    const source = filters ?? {};
    const allowedKeys = new Set([
      'stageId',
      'ownerId',
      'status',
      'minValue',
      'maxValue',
      'createdFrom',
      'createdTo',
    ]);
    if (Object.keys(source).some((key) => !allowedKeys.has(key))) {
      throw new BadRequestException('filters contains an unsupported field');
    }

    const normalized: NormalizedBulkMoveFilters = {
      stageId:
        source.stageId === undefined
          ? null
          : this.requireUuid(source.stageId, 'filters.stageId'),
      ownerId:
        source.ownerId === undefined
          ? null
          : this.requireText(source.ownerId, 'filters.ownerId', 255),
      status:
        source.status === undefined ? null : this.requireStatus(source.status),
      minValue:
        source.minValue === undefined
          ? null
          : this.normalizeMoney(source.minValue, 'filters.minValue'),
      maxValue:
        source.maxValue === undefined
          ? null
          : this.normalizeMoney(source.maxValue, 'filters.maxValue'),
      createdFrom:
        source.createdFrom === undefined
          ? null
          : this.normalizeTimestamp(source.createdFrom, 'filters.createdFrom'),
      createdTo:
        source.createdTo === undefined
          ? null
          : this.normalizeTimestamp(source.createdTo, 'filters.createdTo'),
    };

    if (
      normalized.minValue !== null &&
      normalized.maxValue !== null &&
      this.moneyToMinor(normalized.minValue) >
        this.moneyToMinor(normalized.maxValue)
    ) {
      throw new BadRequestException(
        'filters.minValue must be less than or equal to filters.maxValue',
      );
    }
    if (
      normalized.createdFrom !== null &&
      normalized.createdTo !== null &&
      normalized.createdFrom >= normalized.createdTo
    ) {
      throw new BadRequestException(
        'filters.createdFrom must be earlier than filters.createdTo',
      );
    }

    return normalized;
  }

  private snapshotInsertSql(filters: NormalizedBulkMoveFilters): string {
    const conditions = [
      'o.workspace_id = :workspaceId',
      'o.pipeline_id = :pipelineId',
    ];
    if (filters.stageId !== null) conditions.push('o.stage_id = :stageId');
    if (filters.ownerId !== null) conditions.push('o.owner_id = :ownerId');
    if (filters.status !== null) conditions.push('o.status = :status');
    if (filters.minValue !== null) conditions.push('o.value >= :minValue');
    if (filters.maxValue !== null) conditions.push('o.value <= :maxValue');
    if (filters.createdFrom !== null) {
      conditions.push('o.created_at >= CAST(:createdFrom AS timestamptz)');
    }
    if (filters.createdTo !== null) {
      conditions.push('o.created_at < CAST(:createdTo AS timestamptz)');
    }

    return `WITH inserted AS (
        INSERT INTO bulk_move_items (
          workspace_id, pipeline_id, job_id, opportunity_id,
          snapshot_stage_id, snapshot_stage_revision
        )
        SELECT o.workspace_id, o.pipeline_id, :jobId, o.id,
               o.stage_id, o.stage_revision
        FROM opportunities AS o
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY o.id
        LIMIT ${MAX_SNAPSHOT_SIZE + 1}
        RETURNING 1
      )
      SELECT COUNT(*)::integer AS snapshot_count FROM inserted`;
  }

  private hashRequest(
    workspaceId: string,
    pipelineId: string,
    destinationStageId: string,
    filters: NormalizedBulkMoveFilters,
  ): string {
    const canonicalRequest = JSON.stringify({
      workspaceId,
      pipelineId,
      destinationStageId,
      filters,
    });
    return createHash('sha256').update(canonicalRequest).digest('hex');
  }

  private requireUuid(value: unknown, field: string): string {
    if (!isUuidFormat(value)) {
      throw new BadRequestException(uuidFormatError(field));
    }
    return value.toLowerCase();
  }

  private requireText(
    value: unknown,
    field: string,
    maximumLength: number,
  ): string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.length > maximumLength
    ) {
      throw new BadRequestException(
        `${field} must be a non-empty string of at most ${maximumLength} characters`,
      );
    }
    return value.trim();
  }

  private normalizeMoney(value: unknown, field: string): string {
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      !MONEY_PATTERN.test(String(value))
    ) {
      throw new BadRequestException(`${field} must be a valid monetary amount`);
    }

    const [integerPart, fractionalPart = ''] = String(value).split('.');
    const isZero =
      BigInt(integerPart.replace('-', '')) === 0n &&
      (fractionalPart === '' || /^0+$/.test(fractionalPart));
    const sign = String(value).startsWith('-') && !isZero ? '-' : '';
    const integer = integerPart.replace('-', '').replace(/^0+(?=\d)/, '');
    const fraction = fractionalPart.replace(/0+$/, '');
    return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
  }

  private moneyToMinor(value: string): bigint {
    const negative = value.startsWith('-');
    const [integerPart, fractionalPart = ''] = value
      .replace('-', '')
      .split('.');
    const minor =
      BigInt(integerPart) * 100n + BigInt(fractionalPart.padEnd(2, '0'));
    return negative ? -minor : minor;
  }

  private normalizeTimestamp(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a UTC timestamp`);
    }
    const match = UTC_TIMESTAMP_PATTERN.exec(value);
    if (!match) {
      throw new BadRequestException(`${field} must be a UTC timestamp`);
    }

    const [, year, month, day, hour, minute, second, fraction = ''] = match;
    const datePart = `${year}-${month}-${day}`;
    const parsedDate = new Date(`${datePart}T00:00:00.000Z`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== datePart ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    ) {
      throw new BadRequestException(`${field} must be a valid UTC timestamp`);
    }

    return `${datePart}T${hour}:${minute}:${second}.${fraction.padEnd(6, '0')}Z`;
  }

  private requireStatus(value: unknown): NormalizedBulkMoveFilters['status'] {
    if (
      typeof value !== 'string' ||
      !OPPORTUNITY_STATUSES.includes(
        value as (typeof OPPORTUNITY_STATUSES)[number],
      )
    ) {
      throw new BadRequestException(
        `filters.status must be one of: ${OPPORTUNITY_STATUSES.join(', ')}`,
      );
    }
    return value as NormalizedBulkMoveFilters['status'];
  }
}
