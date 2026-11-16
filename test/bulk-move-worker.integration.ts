import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { APPLICATION_CONFIGURATION } from '../src/config/configuration.module';
import type { ApplicationConfiguration } from '../src/config/env.validation';
import { BulkMoveWorkerModule } from '../src/opportunities/bulk-moves/worker/bulk-move-worker.module';
import { BulkMoveWorker } from '../src/opportunities/bulk-moves/worker/bulk-move-worker.service';

jest.setTimeout(30_000);

interface Fixture {
  workspaceId: string;
  pipelineId: string;
  sourceStageId: string;
  destinationStageId: string;
  manualStageId: string;
  opportunityIds: string[];
  jobIds: string[];
}

interface QueryRow {
  [key: string]: string | number | boolean | null;
}

describe('Bulk move worker PostgreSQL integration', () => {
  let app: INestApplicationContext;
  let sequelize: Sequelize;
  let worker: BulkMoveWorker;
  let fixture: Fixture;
  let fixtureCreated = false;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(BulkMoveWorkerModule, {
      logger: false,
    });
    sequelize = app.get<Sequelize>(getConnectionToken());
    await sequelize.authenticate();
    const [schema] = await selectRows(
      `SELECT to_regclass('public.workspaces') AS table_name`,
    );
    if (!schema?.table_name) {
      throw new Error(
        'Database schema is not migrated; run npm run db:migrate before integration tests.',
      );
    }
    worker = app.get(BulkMoveWorker);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    fixture = {
      workspaceId: randomUUID(),
      pipelineId: randomUUID(),
      sourceStageId: randomUUID(),
      destinationStageId: randomUUID(),
      manualStageId: randomUUID(),
      opportunityIds: [],
      jobIds: [],
    };
    await sequelize.query(
      `INSERT INTO workspaces (id, name) VALUES (:id, 'worker integration')`,
      { replacements: { id: fixture.workspaceId } },
    );
    fixtureCreated = true;
    await sequelize.query(
      `INSERT INTO pipelines (id, workspace_id, name)
       VALUES (:id, :workspaceId, 'worker integration')`,
      {
        replacements: {
          id: fixture.pipelineId,
          workspaceId: fixture.workspaceId,
        },
      },
    );
    for (const [id, name, position] of [
      [fixture.sourceStageId, 'Source', 0],
      [fixture.destinationStageId, 'Destination', 1],
      [fixture.manualStageId, 'Manual edit', 2],
    ] as const) {
      await sequelize.query(
        `INSERT INTO stages (id, workspace_id, pipeline_id, name, position)
         VALUES (:id, :workspaceId, :pipelineId, :name, :position)`,
        {
          replacements: {
            id,
            workspaceId: fixture.workspaceId,
            pipelineId: fixture.pipelineId,
            name,
            position,
          },
        },
      );
    }
  });

  afterEach(async () => {
    if (!fixtureCreated) {
      return;
    }
    await sequelize.transaction(async (transaction) => {
      for (const table of [
        'bulk_move_items',
        'stage_transitions',
        'bulk_move_jobs',
        'opportunities',
        'stages',
        'pipelines',
        'workspaces',
      ]) {
        await sequelize.query(
          `DELETE FROM ${table} WHERE workspace_id = :workspaceId`,
          {
            replacements: { workspaceId: fixture.workspaceId },
            transaction,
          },
        );
      }
    });
    fixtureCreated = false;
  });

  it('moves snapshot matches and preserves manual edits with explicit outcomes', async () => {
    const jobId = await createJob(3);
    const [manualOpportunityId, alreadyAtDestinationId] =
      fixture.opportunityIds.slice(1);
    await sequelize.query(
      `UPDATE opportunities
       SET stage_id = :stageId, stage_revision = 1
       WHERE workspace_id = :workspaceId AND id = :id`,
      {
        replacements: {
          stageId: fixture.manualStageId,
          workspaceId: fixture.workspaceId,
          id: manualOpportunityId,
        },
      },
    );
    await addTransition(
      manualOpportunityId,
      fixture.sourceStageId,
      fixture.manualStageId,
    );
    await sequelize.query(
      `UPDATE opportunities
       SET stage_id = :stageId, stage_revision = 1
       WHERE workspace_id = :workspaceId AND id = :id`,
      {
        replacements: {
          stageId: fixture.destinationStageId,
          workspaceId: fixture.workspaceId,
          id: alreadyAtDestinationId,
        },
      },
    );
    await addTransition(
      alreadyAtDestinationId,
      fixture.sourceStageId,
      fixture.destinationStageId,
    );

    await drainJob(jobId);

    const items = await selectRows(
      `SELECT opportunity_id, outcome
       FROM bulk_move_items
       WHERE workspace_id = :workspaceId AND job_id = :jobId
       ORDER BY opportunity_id`,
      { workspaceId: fixture.workspaceId, jobId },
    );
    const finalOpps = await selectRows(
      `SELECT id, stage_id, stage_revision
       FROM opportunities
       WHERE workspace_id = :workspaceId
       ORDER BY id`,
      { workspaceId: fixture.workspaceId },
    );
    const transitions = await selectRows(
      `SELECT opportunity_id
       FROM stage_transitions
       WHERE workspace_id = :workspaceId`,
      { workspaceId: fixture.workspaceId },
    );
    const job = await getJob(jobId);

    const outcomeById = new Map(
      items.map((item) => [item.opportunity_id, item.outcome]),
    );
    expect(outcomeById.get(fixture.opportunityIds[0])).toBe('moved');
    expect(outcomeById.get(manualOpportunityId)).toBe('skipped_conflict');
    expect(outcomeById.get(alreadyAtDestinationId)).toBe(
      'skipped_already_at_destination',
    );
    expect(
      finalOpps.find((row) => row.id === manualOpportunityId),
    ).toMatchObject({
      stage_id: fixture.manualStageId,
      stage_revision: '1',
    });
    expect(
      finalOpps.find((row) => row.id === alreadyAtDestinationId),
    ).toMatchObject({
      stage_id: fixture.destinationStageId,
      stage_revision: '1',
    });
    expect(transitions).toHaveLength(3);
    expect(new Set(transitions.map((row) => row.opportunity_id)).size).toBe(3);
    expect(job).toMatchObject({
      status: 'completed',
      snapshot_count: 3,
      moved_count: 1,
      skipped_conflict_count: 1,
      skipped_already_at_destination_count: 1,
    });
  });

  it('completes an empty snapshot', async () => {
    const jobId = await createJob(0);
    await drainJob(jobId);
    expect(await getJob(jobId)).toMatchObject({
      status: 'completed',
      snapshot_count: 0,
      moved_count: 0,
    });
  });

  it('reclaims an expired lease and resumes only pending items without duplicate transitions', async () => {
    const jobId = await createJob(101);
    const firstClaim = await worker.claimNextJob();
    expect(firstClaim?.id).toBe(jobId);
    expect(await worker.processChunk(firstClaim!)).toMatchObject({
      kind: 'progress',
      processed: 100,
    });

    await sequelize.query(
      `UPDATE bulk_move_jobs
       SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
       WHERE id = :jobId`,
      { replacements: { jobId } },
    );

    const resumedClaim = await worker.claimNextJob();
    expect(resumedClaim?.id).toBe(jobId);
    expect(BigInt(resumedClaim!.lease_generation)).toBeGreaterThan(
      BigInt(firstClaim!.lease_generation),
    );
    await drainClaimedJob(resumedClaim!);

    const transitionCounts = await selectRows(
      `SELECT opportunity_id, COUNT(*)::integer AS count
       FROM stage_transitions
       WHERE workspace_id = :workspaceId
       GROUP BY opportunity_id`,
      { workspaceId: fixture.workspaceId },
    );
    expect(transitionCounts).toHaveLength(101);
    expect(transitionCounts.every((row) => Number(row.count) === 1)).toBe(true);
    expect(await getJob(jobId)).toMatchObject({
      status: 'completed',
      snapshot_count: 101,
      moved_count: 101,
      attempt_count: 0,
    });
  });

  it('allows only one running job per workspace when workers claim concurrently', async () => {
    const firstJobId = await createJob(1);
    const secondJobId = await createJob(1);
    const anotherWorker = new BulkMoveWorker(
      sequelize,
      app.get<ApplicationConfiguration>(APPLICATION_CONFIGURATION),
    );

    const claims = await Promise.all([
      worker.claimNextJob(),
      anotherWorker.claimNextJob(),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect([firstJobId, secondJobId]).toContain(claims.find(Boolean)?.id);

    const statuses = await selectRows(
      `SELECT status FROM bulk_move_jobs WHERE workspace_id = :workspaceId`,
      { workspaceId: fixture.workspaceId },
    );
    expect(statuses.filter((row) => row.status === 'running')).toHaveLength(1);
    expect(statuses.filter((row) => row.status === 'retry_wait')).toHaveLength(
      1,
    );
  });

  it('waits instead of completing or failing when all pending opportunity rows are locked', async () => {
    const jobId = await createJob(1);
    const claim = await worker.claimNextJob();
    expect(claim?.id).toBe(jobId);

    let releaseLock!: () => void;
    let signalLockReady!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      signalLockReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `SELECT id FROM opportunities WHERE id = :id FOR UPDATE`,
        {
          replacements: { id: fixture.opportunityIds[0] },
          transaction,
        },
      );
      signalLockReady();
      await release;
    });
    await lockReady;

    try {
      expect(await worker.processChunk(claim!)).toEqual({ kind: 'waiting' });
      expect(await getJob(jobId)).toMatchObject({ status: 'running' });
      expect(
        (
          await selectRows(
            `SELECT outcome FROM bulk_move_items WHERE job_id = :jobId`,
            { jobId },
          )
        )[0],
      ).toMatchObject({ outcome: 'pending' });
    } finally {
      releaseLock();
      await lockTransaction;
    }

    await drainClaimedJob(claim!);
    expect(await getJob(jobId)).toMatchObject({ status: 'completed' });
  });

  it('fails repeatedly expired jobs after the configured attempt budget', async () => {
    const jobId = await createJob(1);
    await sequelize.query(
      `UPDATE bulk_move_jobs
       SET status = 'running',
           lease_owner = 'dead-worker',
           lease_generation = 5,
           lease_expires_at = clock_timestamp() - INTERVAL '1 second',
           attempt_count = 7
       WHERE id = :jobId`,
      { replacements: { jobId } },
    );

    expect(await worker.claimNextJob()).toBeNull();
    expect(await getJob(jobId)).toMatchObject({
      status: 'failed',
      failure_reason: 'retry_exhausted',
      attempt_count: 8,
      lease_owner: null,
    });
    expect(
      (
        await selectRows(
          `SELECT outcome FROM bulk_move_items WHERE job_id = :jobId`,
          { jobId },
        )
      )[0],
    ).toMatchObject({ outcome: 'pending' });
  });

  it('resumes exhausted jobs without recreating or replaying terminal outcomes', async () => {
    const jobId = await createJob(2);
    const [completedOpportunityId] = fixture.opportunityIds;
    await sequelize.query(
      `UPDATE bulk_move_items
       SET outcome = 'moved', processed_at = clock_timestamp()
       WHERE job_id = :jobId AND opportunity_id = :opportunityId`,
      {
        replacements: { jobId, opportunityId: completedOpportunityId },
      },
    );
    await sequelize.query(
      `UPDATE opportunities
       SET stage_id = :destinationStageId, stage_revision = 1
       WHERE id = :opportunityId`,
      {
        replacements: {
          destinationStageId: fixture.destinationStageId,
          opportunityId: completedOpportunityId,
        },
      },
    );
    await addTransition(
      completedOpportunityId,
      fixture.sourceStageId,
      fixture.destinationStageId,
    );
    await sequelize.query(
      `UPDATE bulk_move_jobs
       SET status = 'failed',
           failure_reason = 'retry_exhausted',
           attempt_count = 8,
           moved_count = 1,
           last_error = 'test'
       WHERE id = :jobId`,
      { replacements: { jobId } },
    );
    const originalItems = await selectRows(
      `SELECT opportunity_id, outcome
       FROM bulk_move_items WHERE job_id = :jobId ORDER BY opportunity_id`,
      { jobId },
    );

    await worker.resumeJob(jobId);
    expect(await getJob(jobId)).toMatchObject({
      status: 'queued',
      failure_reason: null,
      attempt_count: 0,
      moved_count: 1,
    });
    expect(
      await selectRows(
        `SELECT opportunity_id, outcome
         FROM bulk_move_items WHERE job_id = :jobId ORDER BY opportunity_id`,
        { jobId },
      ),
    ).toEqual(originalItems);

    await drainJob(jobId);
    const transitions = await selectRows(
      `SELECT opportunity_id
       FROM stage_transitions
       WHERE workspace_id = :workspaceId`,
      { workspaceId: fixture.workspaceId },
    );
    expect(
      transitions.filter(
        (row) => row.opportunity_id === completedOpportunityId,
      ),
    ).toHaveLength(1);
    expect(await getJob(jobId)).toMatchObject({
      status: 'completed',
      moved_count: 2,
    });
  });

  it('rejects a stale fencing generation before touching any opportunities', async () => {
    const jobId = await createJob(1);
    const claim = await worker.claimNextJob();
    expect(claim?.id).toBe(jobId);
    await sequelize.query(
      `UPDATE bulk_move_jobs
       SET lease_generation = lease_generation + 1
       WHERE id = :jobId`,
      { replacements: { jobId } },
    );

    expect(await worker.processChunk(claim!)).toEqual({ kind: 'stale' });
    expect(
      (
        await selectRows(
          `SELECT outcome FROM bulk_move_items WHERE job_id = :jobId`,
          { jobId },
        )
      )[0],
    ).toMatchObject({ outcome: 'pending' });
    expect(
      await selectRows(
        `SELECT id FROM stage_transitions WHERE workspace_id = :workspaceId`,
        { workspaceId: fixture.workspaceId },
      ),
    ).toHaveLength(0);
  });

  async function createJob(count: number): Promise<string> {
    const jobId = randomUUID();
    fixture.jobIds.push(jobId);
    await sequelize.query(
      `INSERT INTO bulk_move_jobs (
         id, workspace_id, pipeline_id, destination_stage_id,
         idempotency_key, request_hash, filters, snapshot_count
       )
       VALUES (
         :id, :workspaceId, :pipelineId, :destinationStageId,
         :key, :hash, '{}'::jsonb, :count
       )`,
      {
        replacements: {
          id: jobId,
          workspaceId: fixture.workspaceId,
          pipelineId: fixture.pipelineId,
          destinationStageId: fixture.destinationStageId,
          key: randomUUID(),
          hash: '0'.repeat(64),
          count,
        },
      },
    );

    fixture.opportunityIds = Array.from({ length: count }, () => randomUUID());
    if (count > 0) {
      const values = fixture.opportunityIds
        .map(
          (_, index) =>
            `(:workspaceId, :pipelineId, :opportunity${index}, :stageId, 'Integration ${index}', 10.00, 'open', 'owner-1')`,
        )
        .join(', ');
      const replacements: Record<string, string> = {
        workspaceId: fixture.workspaceId,
        pipelineId: fixture.pipelineId,
        stageId: fixture.sourceStageId,
      };
      fixture.opportunityIds.forEach((id, index) => {
        replacements[`opportunity${index}`] = id;
      });
      await sequelize.query(
        `INSERT INTO opportunities (
           workspace_id, pipeline_id, id, stage_id, name, value, status, owner_id
         ) VALUES ${values}`,
        { replacements },
      );
      await sequelize.query(
        `INSERT INTO bulk_move_items (
           workspace_id, pipeline_id, job_id, opportunity_id,
           snapshot_stage_id, snapshot_stage_revision
         )
         SELECT workspace_id, pipeline_id, :jobId, id, stage_id, stage_revision
         FROM opportunities
         WHERE workspace_id = :workspaceId
           AND pipeline_id = :pipelineId
           AND id IN (:opportunityIds)`,
        {
          replacements: {
            jobId,
            workspaceId: fixture.workspaceId,
            pipelineId: fixture.pipelineId,
            opportunityIds: fixture.opportunityIds,
          },
        },
      );
    }
    return jobId;
  }

  async function addTransition(
    opportunityId: string,
    fromStageId: string,
    toStageId: string,
  ): Promise<void> {
    await sequelize.query(
      `INSERT INTO stage_transitions (
         workspace_id, pipeline_id, opportunity_id, from_stage_id, to_stage_id
       ) VALUES (:workspaceId, :pipelineId, :opportunityId, :fromStageId, :toStageId)`,
      {
        replacements: {
          workspaceId: fixture.workspaceId,
          pipelineId: fixture.pipelineId,
          opportunityId,
          fromStageId,
          toStageId,
        },
      },
    );
  }

  async function drainJob(jobId: string): Promise<void> {
    const claim = await worker.claimNextJob();
    expect(claim?.id).toBe(jobId);
    await drainClaimedJob(claim!);
  }

  async function drainClaimedJob(
    claim: NonNullable<Awaited<ReturnType<BulkMoveWorker['claimNextJob']>>>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await worker.processChunk(claim);
      if (result.kind === 'completed') return;
      expect(result.kind).not.toBe('stale');
      if (result.kind === 'waiting') {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(`Job ${claim.id} did not complete in the test window`);
  }

  async function getJob(jobId: string): Promise<QueryRow> {
    const rows = await selectRows(
      `SELECT status, failure_reason, snapshot_count, moved_count,
              skipped_conflict_count, skipped_already_at_destination_count,
              attempt_count, lease_owner
       FROM bulk_move_jobs
       WHERE workspace_id = :workspaceId AND id = :jobId`,
      { workspaceId: fixture.workspaceId, jobId },
    );
    return rows[0];
  }

  async function selectRows(
    query: string,
    replacements: Record<string, string | number>,
  ): Promise<QueryRow[]> {
    return sequelize.query<QueryRow>(query, {
      replacements,
      type: QueryTypes.SELECT,
    });
  }
});
