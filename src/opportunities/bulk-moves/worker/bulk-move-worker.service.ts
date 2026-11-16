import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { APPLICATION_CONFIGURATION } from '../../../config/configuration.module';
import type { ApplicationConfiguration } from '../../../config/env.validation';

interface ClaimedJob {
  id: string;
  workspace_id: string;
  pipeline_id: string;
  lease_generation: string;
}

interface LockedJob extends ClaimedJob {
  destination_stage_id: string;
  snapshot_count: number;
  moved_count: number;
  skipped_conflict_count: number;
  skipped_already_at_destination_count: number;
  valid_lease: boolean;
}

interface PendingItem {
  opportunity_id: string;
  snapshot_stage_id: string;
  snapshot_stage_revision: string;
  current_stage_id: string;
  current_stage_revision: string;
}

interface CountRow {
  count: number;
}

type ChunkResult =
  | { kind: 'progress'; processed: number }
  | { kind: 'waiting' }
  | { kind: 'completed' }
  | { kind: 'stale' };

@Injectable()
export class BulkMoveWorker {
  private readonly logger = new Logger(BulkMoveWorker.name);
  private readonly workerId = `${hostname()}-${process.pid}-${randomUUID()}`;
  private stopping = false;

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @Inject(APPLICATION_CONFIGURATION)
    private readonly configuration: ApplicationConfiguration,
  ) {}

  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const job = await this.claimNextJob();
        if (!job) {
          await this.delay(this.configuration.worker.pollMs);
          continue;
        }
        await this.processClaimedJob(job);
      } catch (error) {
        this.logger.error(
          `Worker loop error: ${this.errorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.delay(this.configuration.worker.pollMs);
      }
    }
  }

  stop(): void {
    this.stopping = true;
  }

  async resumeJob(jobId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const rows = await this.sequelize.query<{ id: string; status: string }>(
        `SELECT id, status
         FROM bulk_move_jobs
         WHERE id = :jobId
         FOR UPDATE`,
        {
          replacements: { jobId },
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      const job = rows[0];
      if (!job) {
        throw new Error(`Bulk move job ${jobId} was not found`);
      }
      if (job.status !== 'failed') {
        throw new Error(`Bulk move job ${jobId} is not failed`);
      }

      await this.sequelize.query(
        `UPDATE bulk_move_jobs
         SET status = 'queued',
             failure_reason = NULL,
             attempt_count = 0,
             next_attempt_at = NULL,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error = NULL,
             updated_at = clock_timestamp()
         WHERE id = :jobId AND status = 'failed'`,
        { replacements: { jobId }, transaction },
      );
    });
  }

  async claimNextJob(): Promise<ClaimedJob | null> {
    let candidateId: string | null = null;
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const candidates = await this.sequelize.query<
          ClaimedJob & {
            status: string;
            attempt_count: number;
          }
        >(
          `SELECT id, workspace_id, pipeline_id, lease_generation,
                  attempt_count, status
           FROM bulk_move_jobs
           WHERE status = 'queued'
              OR (status = 'retry_wait' AND next_attempt_at <= clock_timestamp())
              OR (status = 'running' AND lease_expires_at <= clock_timestamp())
           ORDER BY
             CASE status
               WHEN 'running' THEN 0
               WHEN 'retry_wait' THEN 1
               ELSE 2
             END,
             created_at,
             id
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          { transaction, type: QueryTypes.SELECT },
        );
        const candidate = candidates[0];
        if (!candidate) {
          return null;
        }
        candidateId = candidate.id;

        const expiredLease = candidate.status === 'running';
        const nextAttemptCount =
          Number(candidate.attempt_count) + (expiredLease ? 1 : 0);
        if (
          expiredLease &&
          nextAttemptCount >= this.configuration.worker.maxAttempts
        ) {
          await this.sequelize.query(
            `UPDATE bulk_move_jobs
             SET status = 'failed',
                 failure_reason = 'retry_exhausted',
                 attempt_count = :attemptCount,
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 next_attempt_at = NULL,
                 last_error = 'Worker lease expired before the next attempt',
                 updated_at = clock_timestamp()
             WHERE id = :jobId`,
            {
              replacements: {
                attemptCount: nextAttemptCount,
                jobId: candidate.id,
              },
              transaction,
            },
          );
          return null;
        }

        const claimed = await this.sequelize.query<ClaimedJob>(
          `UPDATE bulk_move_jobs
           SET status = 'running',
               lease_owner = :workerId,
               lease_generation = lease_generation + 1,
               lease_expires_at =
                 clock_timestamp() + (:leaseMs * INTERVAL '1 millisecond'),
               heartbeat_at = clock_timestamp(),
               next_attempt_at = NULL,
               attempt_count = :attemptCount,
               failure_reason = NULL,
               updated_at = clock_timestamp()
           WHERE id = :jobId
           RETURNING id, workspace_id, pipeline_id, lease_generation`,
          {
            replacements: {
              workerId: this.workerId,
              leaseMs: this.configuration.worker.leaseMs,
              attemptCount: nextAttemptCount,
              jobId: candidate.id,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        return claimed[0] ?? null;
      });
    } catch (error) {
      if (!this.isWorkspaceSlotConflict(error) || !candidateId) {
        throw error;
      }
      await this.deferContendedJob(candidateId);
      return null;
    }
  }

  async processChunk(job: ClaimedJob): Promise<ChunkResult> {
    return this.sequelize.transaction(async (transaction) => {
      const lockedJobs = await this.sequelize.query<LockedJob>(
        `SELECT id, workspace_id, pipeline_id, lease_generation,
                destination_stage_id, snapshot_count, moved_count,
                skipped_conflict_count, skipped_already_at_destination_count,
                (status = 'running'
                  AND lease_owner = :workerId
                  AND lease_generation = :generation
                  AND lease_expires_at > clock_timestamp()) AS valid_lease
         FROM bulk_move_jobs
         WHERE id = :jobId AND workspace_id = :workspaceId
         FOR UPDATE`,
        {
          replacements: {
            workerId: this.workerId,
            generation: job.lease_generation,
            jobId: job.id,
            workspaceId: job.workspace_id,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      const lockedJob = lockedJobs[0];
      if (!lockedJob || !lockedJob.valid_lease) {
        return { kind: 'stale' };
      }

      const workspaces = await this.sequelize.query<{ id: string }>(
        `SELECT id FROM workspaces WHERE id = :workspaceId FOR UPDATE`,
        {
          replacements: { workspaceId: job.workspace_id },
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      if (workspaces.length !== 1) {
        throw new Error(
          `Workspace ${job.workspace_id} for job ${job.id} is missing`,
        );
      }

      const items = await this.sequelize.query<PendingItem>(
        `SELECT i.opportunity_id,
                i.snapshot_stage_id,
                i.snapshot_stage_revision,
                o.stage_id AS current_stage_id,
                o.stage_revision AS current_stage_revision
         FROM bulk_move_items AS i
         JOIN opportunities AS o
           ON o.id = i.opportunity_id
          AND o.workspace_id = i.workspace_id
          AND o.pipeline_id = i.pipeline_id
         WHERE i.workspace_id = :workspaceId
           AND i.pipeline_id = :pipelineId
           AND i.job_id = :jobId
           AND i.outcome = 'pending'
         ORDER BY i.opportunity_id
         LIMIT :chunkSize
         FOR UPDATE OF o SKIP LOCKED`,
        {
          replacements: {
            workspaceId: job.workspace_id,
            pipelineId: job.pipeline_id,
            jobId: job.id,
            chunkSize: this.configuration.worker.chunkSize,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      );

      if (items.length === 0) {
        const pending = await this.sequelize.query<CountRow>(
          `SELECT COUNT(*)::integer AS count
           FROM bulk_move_items
           WHERE workspace_id = :workspaceId
             AND pipeline_id = :pipelineId
             AND job_id = :jobId
             AND outcome = 'pending'`,
          {
            replacements: {
              workspaceId: job.workspace_id,
              pipelineId: job.pipeline_id,
              jobId: job.id,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (Number(pending[0]?.count ?? 0) > 0) {
          return { kind: 'waiting' };
        }

        const itemCounts = await this.sequelize.query<{
          total_count: number;
          terminal_count: number;
        }>(
          `SELECT COUNT(*)::integer AS total_count,
                  COUNT(*) FILTER (WHERE outcome <> 'pending')::integer AS terminal_count
           FROM bulk_move_items
           WHERE workspace_id = :workspaceId
             AND pipeline_id = :pipelineId
             AND job_id = :jobId`,
          {
            replacements: {
              workspaceId: job.workspace_id,
              pipelineId: job.pipeline_id,
              jobId: job.id,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        const counts = itemCounts[0];
        if (
          Number(counts?.total_count) !== Number(lockedJob.snapshot_count) ||
          Number(counts?.terminal_count) !== Number(lockedJob.snapshot_count)
        ) {
          throw new Error(
            `Snapshot item count invariant failed for job ${job.id}`,
          );
        }

        const completed = await this.sequelize.query<{ id: string }>(
          `UPDATE bulk_move_jobs
           SET status = 'completed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               completed_at = clock_timestamp(),
               heartbeat_at = clock_timestamp(),
               updated_at = clock_timestamp()
           WHERE id = :jobId
             AND workspace_id = :workspaceId
             AND status = 'running'
             AND lease_owner = :workerId
             AND lease_generation = :generation
             AND lease_expires_at > clock_timestamp()
           RETURNING id`,
          {
            replacements: {
              jobId: job.id,
              workspaceId: job.workspace_id,
              workerId: this.workerId,
              generation: job.lease_generation,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        return completed.length === 1
          ? { kind: 'completed' }
          : { kind: 'stale' };
      }

      let moved = 0;
      let skippedConflict = 0;
      let skippedAtDestination = 0;
      for (const item of items) {
        let outcome:
          'moved' | 'skipped_conflict' | 'skipped_already_at_destination';
        if (item.current_stage_id === lockedJob.destination_stage_id) {
          outcome = 'skipped_already_at_destination';
          skippedAtDestination += 1;
        } else if (
          item.current_stage_id !== item.snapshot_stage_id ||
          item.current_stage_revision !== item.snapshot_stage_revision
        ) {
          outcome = 'skipped_conflict';
          skippedConflict += 1;
        } else {
          const updated = await this.sequelize.query<{ id: string }>(
            `UPDATE opportunities
             SET stage_id = :destinationStageId,
                 stage_revision = stage_revision + 1,
                 updated_at = clock_timestamp()
             WHERE workspace_id = :workspaceId
               AND pipeline_id = :pipelineId
               AND id = :opportunityId
               AND stage_id = :snapshotStageId
               AND stage_revision = :snapshotRevision
             RETURNING id`,
            {
              replacements: {
                destinationStageId: lockedJob.destination_stage_id,
                workspaceId: job.workspace_id,
                pipelineId: job.pipeline_id,
                opportunityId: item.opportunity_id,
                snapshotStageId: item.snapshot_stage_id,
                snapshotRevision: item.snapshot_stage_revision,
              },
              transaction,
              type: QueryTypes.SELECT,
            },
          );
          if (updated.length === 1) {
            await this.sequelize.query(
              `INSERT INTO stage_transitions (
                 workspace_id, pipeline_id, opportunity_id,
                 from_stage_id, to_stage_id
               )
               VALUES (
                 :workspaceId, :pipelineId, :opportunityId,
                 :fromStageId, :toStageId
               )`,
              {
                replacements: {
                  workspaceId: job.workspace_id,
                  pipelineId: job.pipeline_id,
                  opportunityId: item.opportunity_id,
                  fromStageId: item.snapshot_stage_id,
                  toStageId: lockedJob.destination_stage_id,
                },
                transaction,
              },
            );
            outcome = 'moved';
            moved += 1;
          } else {
            outcome = 'skipped_conflict';
            skippedConflict += 1;
          }
        }

        const updatedItems = await this.sequelize.query<{
          opportunity_id: string;
        }>(
          `UPDATE bulk_move_items
           SET outcome = :outcome, processed_at = clock_timestamp()
           WHERE workspace_id = :workspaceId
             AND pipeline_id = :pipelineId
             AND job_id = :jobId
             AND opportunity_id = :opportunityId
             AND outcome = 'pending'
           RETURNING opportunity_id`,
          {
            replacements: {
              outcome,
              workspaceId: job.workspace_id,
              pipelineId: job.pipeline_id,
              jobId: job.id,
              opportunityId: item.opportunity_id,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (updatedItems.length !== 1) {
          throw new Error(
            `Pending item changed while processing job ${job.id}`,
          );
        }
      }

      const fencedUpdates = await this.sequelize.query<{ id: string }>(
        `UPDATE bulk_move_jobs
         SET moved_count = moved_count + :moved,
             skipped_conflict_count = skipped_conflict_count + :skippedConflict,
             skipped_already_at_destination_count =
               skipped_already_at_destination_count + :skippedAtDestination,
             attempt_count = 0,
             heartbeat_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE id = :jobId
           AND workspace_id = :workspaceId
           AND status = 'running'
           AND lease_owner = :workerId
           AND lease_generation = :generation
           AND lease_expires_at > clock_timestamp()
         RETURNING id`,
        {
          replacements: {
            moved,
            skippedConflict,
            skippedAtDestination,
            jobId: job.id,
            workspaceId: job.workspace_id,
            workerId: this.workerId,
            generation: job.lease_generation,
          },
          transaction,
          type: QueryTypes.SELECT,
        },
      );
      if (fencedUpdates.length !== 1) {
        throw new Error(`Lease fencing rejected chunk for job ${job.id}`);
      }
      return { kind: 'progress', processed: items.length };
    });
  }

  private async processClaimedJob(job: ClaimedJob): Promise<void> {
    while (!this.stopping) {
      let result: ChunkResult;
      try {
        result = await this.processChunk(job);
      } catch (error) {
        await this.recordFailure(job, error);
        return;
      }

      if (result.kind === 'completed' || result.kind === 'stale') {
        return;
      }
      if (result.kind === 'waiting') {
        if (!(await this.renewLease(job))) {
          return;
        }
        await this.delay(this.configuration.worker.chunkPauseMs);
        continue;
      }

      if (!(await this.renewLease(job))) {
        return;
      }
      await this.delay(this.configuration.worker.chunkPauseMs);
    }
  }

  private async renewLease(job: ClaimedJob): Promise<boolean> {
    const updated = await this.sequelize.query<{ id: string }>(
      `UPDATE bulk_move_jobs
       SET lease_expires_at =
             clock_timestamp() + (:leaseMs * INTERVAL '1 millisecond'),
           heartbeat_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE id = :jobId
         AND workspace_id = :workspaceId
         AND status = 'running'
         AND lease_owner = :workerId
         AND lease_generation = :generation
         AND lease_expires_at > clock_timestamp()
       RETURNING id`,
      {
        replacements: {
          leaseMs: this.configuration.worker.leaseMs,
          jobId: job.id,
          workspaceId: job.workspace_id,
          workerId: this.workerId,
          generation: job.lease_generation,
        },
        type: QueryTypes.SELECT,
      },
    );
    return updated.length === 1;
  }

  private async recordFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const attemptCount = await this.sequelize.transaction(
      async (transaction) => {
        const jobs = await this.sequelize.query<{ attempt_count: number }>(
          `SELECT attempt_count
         FROM bulk_move_jobs
         WHERE id = :jobId
           AND workspace_id = :workspaceId
           AND status = 'running'
           AND lease_owner = :workerId
           AND lease_generation = :generation
           AND lease_expires_at > clock_timestamp()
         FOR UPDATE`,
          {
            replacements: {
              jobId: job.id,
              workspaceId: job.workspace_id,
              workerId: this.workerId,
              generation: job.lease_generation,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        if (!jobs[0]) {
          return null;
        }
        const nextAttempt = Number(jobs[0].attempt_count) + 1;
        const exhausted = nextAttempt >= this.configuration.worker.maxAttempts;
        const delayMs = this.retryDelay(nextAttempt);
        await this.sequelize.query(
          `UPDATE bulk_move_jobs
         SET status = :status,
             failure_reason = :failureReason,
             attempt_count = :attemptCount,
             lease_owner = NULL,
             lease_expires_at = NULL,
             next_attempt_at = CASE
               WHEN :status = 'retry_wait'
               THEN clock_timestamp() + (:delayMs * INTERVAL '1 millisecond')
               ELSE NULL
             END,
             last_error = :lastError,
             updated_at = clock_timestamp()
         WHERE id = :jobId`,
          {
            replacements: {
              status: exhausted ? 'failed' : 'retry_wait',
              failureReason: exhausted ? 'retry_exhausted' : null,
              attemptCount: nextAttempt,
              delayMs,
              lastError: this.errorMessage(error),
              jobId: job.id,
            },
            transaction,
          },
        );
        return nextAttempt;
      },
    );
    if (attemptCount !== null) {
      this.logger.error(
        `Bulk move job ${job.id} chunk failed on attempt ${attemptCount}: ${this.errorMessage(error)}`,
      );
    }
  }

  private async deferContendedJob(jobId: string): Promise<void> {
    await this.sequelize.query(
      `UPDATE bulk_move_jobs
       SET status = 'retry_wait',
           next_attempt_at =
             clock_timestamp() + (:delayMs * INTERVAL '1 millisecond'),
           updated_at = clock_timestamp()
       WHERE id = :jobId
         AND status IN ('queued', 'retry_wait')
         AND lease_owner IS NULL`,
      {
        replacements: {
          jobId,
          delayMs: this.configuration.worker.pollMs,
        },
      },
    );
  }

  private isWorkspaceSlotConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const candidate = error as {
      original?: { code?: string; constraint?: string };
      parent?: { code?: string; constraint?: string };
    };
    const databaseError = candidate.original ?? candidate.parent;
    return (
      databaseError?.code === '23505' &&
      databaseError.constraint === 'uq_bulk_move_jobs_running_workspace'
    );
  }

  private retryDelay(attempt: number): number {
    const exponential = Math.min(
      this.configuration.worker.backoffMaxMs,
      this.configuration.worker.backoffBaseMs * 2 ** (attempt - 1),
    );
    return Math.max(1, Math.floor(exponential * (0.5 + Math.random() * 0.5)));
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1000);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
