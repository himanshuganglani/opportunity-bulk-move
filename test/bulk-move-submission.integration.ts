import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

jest.setTimeout(30_000);

interface QueryRow {
  id: string;
  snapshot_count: number;
  item_count?: number;
}

describe('Bulk move submission PostgreSQL integration', () => {
  let app: INestApplication<App>;
  let sequelize: Sequelize;
  let workspaceId: string;
  let pipelineId: string;
  let sourceStageId: string;
  let destinationStageId: string;
  let opportunityId: string;
  let fixtureCreated = false;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    sequelize = app.get<Sequelize>(getConnectionToken());
    await sequelize.authenticate();

    const [schema] = await sequelize.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.bulk_move_jobs') AS table_name`,
      { type: QueryTypes.SELECT },
    );
    if (!schema?.table_name) {
      throw new Error(
        'Database schema is not migrated; run npm run db:migrate before integration tests.',
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    workspaceId = randomUUID();
    pipelineId = randomUUID();
    sourceStageId = randomUUID();
    destinationStageId = randomUUID();
    opportunityId = randomUUID();

    await sequelize.query(
      `INSERT INTO workspaces (id, name)
       VALUES (:workspaceId, 'bulk submission integration')`,
      { replacements: { workspaceId } },
    );
    fixtureCreated = true;

    await sequelize.query(
      `INSERT INTO pipelines (id, workspace_id, name)
       VALUES (:pipelineId, :workspaceId, 'bulk submission integration')`,
      { replacements: { pipelineId, workspaceId } },
    );
    await sequelize.query(
      `INSERT INTO stages (id, workspace_id, pipeline_id, name, position)
       VALUES
         (:sourceStageId, :workspaceId, :pipelineId, 'Source', 0),
         (:destinationStageId, :workspaceId, :pipelineId, 'Destination', 1)`,
      {
        replacements: {
          sourceStageId,
          destinationStageId,
          workspaceId,
          pipelineId,
        },
      },
    );
    await sequelize.query(
      `INSERT INTO opportunities (
         id, workspace_id, pipeline_id, stage_id, name, value, status, owner_id
       )
       VALUES (
         :opportunityId, :workspaceId, :pipelineId, :sourceStageId,
         'Submission fixture', 125.00, 'open', 'owner-1'
       )`,
      {
        replacements: {
          opportunityId,
          workspaceId,
          pipelineId,
          sourceStageId,
        },
      },
    );
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
      ]) {
        await sequelize.query(
          `DELETE FROM ${table} WHERE workspace_id = :workspaceId`,
          { replacements: { workspaceId }, transaction },
        );
      }
      await sequelize.query('DELETE FROM workspaces WHERE id = :workspaceId', {
        replacements: { workspaceId },
        transaction,
      });
    });
    fixtureCreated = false;
  });

  it('creates one durable snapshot for concurrent requests with the same idempotency key', async () => {
    const submit = () =>
      request(app.getHttpServer())
        .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
        .set('X-Workspace-Id', workspaceId)
        .set('Idempotency-Key', 'concurrent-integration-request')
        .send({
          destinationStageId,
          filters: { stageId: sourceStageId },
        });

    const responses = await Promise.all([submit(), submit()]);

    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(responses[0].body.jobId).toBe(responses[1].body.jobId);

    const jobs = await sequelize.query<QueryRow>(
      `SELECT id, snapshot_count
       FROM bulk_move_jobs
       WHERE workspace_id = :workspaceId
         AND idempotency_key = 'concurrent-integration-request'`,
      {
        replacements: { workspaceId },
        type: QueryTypes.SELECT,
      },
    );
    const items = await sequelize.query<{ opportunity_id: string }>(
      `SELECT opportunity_id
       FROM bulk_move_items
       WHERE workspace_id = :workspaceId AND job_id = :jobId`,
      {
        replacements: { workspaceId, jobId: responses[0].body.jobId },
        type: QueryTypes.SELECT,
      },
    );

    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0].snapshot_count)).toBe(1);
    expect(items).toEqual([{ opportunity_id: opportunityId }]);
  });
});
