import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/sequelize';
import request from 'supertest';
import { App } from 'supertest/types';
import { BulkMoveJob } from '../../common/models/bulk-move-job.model';
import { Stage } from '../../common/models/stage.model';
import { WorkspaceMiddleware } from '../../common/middleware/workspace.middleware';
import { BulkMovesController } from './bulk-moves.controller';
import { BulkMovesService } from './bulk-moves.service';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pipelineId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const destinationStageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceStageId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const jobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

describe('BulkMovesController', () => {
  let app: INestApplication<App>;
  let sequelize: { transaction: jest.Mock; query: jest.Mock };
  let stageModel: { findOne: jest.Mock };
  let bulkMoveJobModel: { findOne: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    sequelize = {
      transaction: jest.fn(async (callback) => callback({ id: 'transaction' })),
      query: jest.fn(),
    };
    stageModel = {
      findOne: jest.fn().mockResolvedValue({ id: destinationStageId }),
    };
    bulkMoveJobModel = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue([1]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulkMovesController],
      providers: [
        BulkMovesService,
        { provide: getConnectionToken(), useValue: sequelize },
        { provide: getModelToken(Stage), useValue: stageModel },
        { provide: getModelToken(BulkMoveJob), useValue: bulkMoveJobModel },
      ],
    }).compile();

    app = module.createNestApplication();
    const workspaceMiddleware = new WorkspaceMiddleware();
    app.use((request, response, next) =>
      workspaceMiddleware.use(request, response, next),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a durable job and database-side snapshot, returning 202', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ id: jobId }])
      .mockResolvedValueOnce([{ snapshot_count: 2 }]);

    const response = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'request-1')
      .send({
        destinationStageId,
        filters: {
          stageId: sourceStageId.toUpperCase(),
          ownerId: 'owner-1',
          status: 'open',
          minValue: '10.00',
          maxValue: '100.0',
          createdFrom: '2026-01-01T00:00:00Z',
          createdTo: '2026-02-01T00:00:00.1Z',
        },
      })
      .expect(202);

    expect(response.body).toEqual({ jobId, status: 'queued' });
    expect(stageModel.findOne).toHaveBeenCalledTimes(2);
    expect(sequelize.query).toHaveBeenCalledTimes(2);
    const insertJob = sequelize.query.mock.calls[0];
    expect(insertJob[0]).toContain(
      'ON CONFLICT (workspace_id, idempotency_key) DO NOTHING',
    );
    expect(insertJob[1].replacements).toMatchObject({
      workspaceId,
      pipelineId,
      destinationStageId,
      idempotencyKey: 'request-1',
      filters: JSON.stringify({
        stageId: sourceStageId,
        ownerId: 'owner-1',
        status: 'open',
        minValue: '10',
        maxValue: '100',
        createdFrom: '2026-01-01T00:00:00.000000Z',
        createdTo: '2026-02-01T00:00:00.100000Z',
      }),
    });
    const insertSnapshot = sequelize.query.mock.calls[1];
    expect(insertSnapshot[0]).toContain('FROM opportunities AS o');
    expect(insertSnapshot[0]).toContain('ORDER BY o.id');
    expect(insertSnapshot[0]).toContain('LIMIT 50001');
    expect(insertSnapshot[1].replacements).toMatchObject({
      workspaceId,
      pipelineId,
      jobId,
      stageId: sourceStageId,
      ownerId: 'owner-1',
      minValue: '10',
      maxValue: '100',
    });
    expect(bulkMoveJobModel.update).toHaveBeenCalledWith(
      { snapshotCount: 2 },
      expect.objectContaining({
        where: { id: jobId, workspaceId },
        transaction: { id: 'transaction' },
      }),
    );
  });

  it('returns the original job for a retry with the same key and request', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ id: jobId }])
      .mockResolvedValueOnce([{ snapshot_count: 0 }]);
    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'same-key')
      .send({ destinationStageId })
      .expect(202);

    const requestHash =
      sequelize.query.mock.calls[0][1].replacements.requestHash;
    sequelize.query.mockReset().mockResolvedValueOnce([]);
    bulkMoveJobModel.findOne.mockResolvedValueOnce({
      id: jobId,
      requestHash,
      status: 'completed',
    });

    const response = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'same-key')
      .send({ destinationStageId, filters: {} })
      .expect(202);

    expect(response.body).toEqual({ jobId, status: 'completed' });
    expect(bulkMoveJobModel.update).toHaveBeenCalledTimes(1);
  });

  it('resolves a simultaneous same-key insert through the unique constraint', async () => {
    const filters = {
      stageId: null,
      ownerId: null,
      status: null,
      minValue: null,
      maxValue: null,
      createdFrom: null,
      createdTo: null,
    };
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          workspaceId,
          pipelineId,
          destinationStageId,
          filters,
        }),
      )
      .digest('hex');
    bulkMoveJobModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: jobId, requestHash, status: 'running' });
    sequelize.query.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'racing-key')
      .send({ destinationStageId })
      .expect(202);

    expect(response.body).toEqual({ jobId, status: 'running' });
    expect(sequelize.query).toHaveBeenCalledTimes(1);
    expect(bulkMoveJobModel.findOne).toHaveBeenCalledTimes(2);
  });

  it('rejects reusing a key with a different request', async () => {
    bulkMoveJobModel.findOne.mockResolvedValueOnce({
      id: jobId,
      requestHash: '0'.repeat(64),
      status: 'queued',
    });

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'same-key')
      .send({ destinationStageId })
      .expect(422);

    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('rejects snapshots larger than 50,000 without saving snapshot count', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ id: jobId }])
      .mockResolvedValueOnce([{ snapshot_count: 50_001 }]);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'too-many')
      .send({ destinationStageId })
      .expect(422);

    expect(bulkMoveJobModel.update).not.toHaveBeenCalled();
  });

  it('accepts a snapshot of exactly 50,000 opportunities', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ id: jobId }])
      .mockResolvedValueOnce([{ snapshot_count: 50_000 }]);

    const response = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'at-limit')
      .send({ destinationStageId })
      .expect(202);

    expect(response.body).toEqual({ jobId, status: 'queued' });
    expect(bulkMoveJobModel.update).toHaveBeenCalledWith(
      { snapshotCount: 50_000 },
      expect.any(Object),
    );
  });

  it('validates required idempotency keys and normalized filter ranges', async () => {
    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .send({ destinationStageId })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'bad-range')
      .send({
        destinationStageId,
        filters: { minValue: '20', maxValue: '10' },
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'bad-date')
      .send({
        destinationStageId,
        filters: {
          createdFrom: '2026-02-01T00:00:00Z',
          createdTo: '2026-02-01T00:00:00Z',
        },
      })
      .expect(400);

    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('rejects a source stage equal to the destination stage', async () => {
    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'same-source-and-destination')
      .send({
        destinationStageId,
        filters: { stageId: destinationStageId },
      })
      .expect(400);

    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the destination stage is outside the workspace pipeline', async () => {
    stageModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunity-bulk-moves`)
      .set('X-Workspace-Id', workspaceId)
      .set('Idempotency-Key', 'bad-stage')
      .send({ destinationStageId })
      .expect(404);

    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('returns committed progress scoped to workspace, pipeline, and job', async () => {
    bulkMoveJobModel.findOne.mockResolvedValueOnce({
      id: jobId,
      status: 'running',
      snapshotCount: 10,
      movedCount: 4,
      skippedConflictCount: 1,
      skippedAlreadyAtDestinationCount: 2,
      heartbeatAt: new Date('2026-11-16T05:00:00.000Z'),
      failureReason: null,
      lastError: null,
      createdAt: new Date('2026-11-16T04:00:00.000Z'),
      updatedAt: new Date('2026-11-16T05:00:00.000Z'),
      completedAt: null,
    });

    const response = await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunity-bulk-moves/${jobId}`)
      .set('X-Workspace-Id', workspaceId)
      .expect(200);

    expect(response.body).toEqual({
      jobId,
      status: 'running',
      snapshotCount: 10,
      movedCount: 4,
      skippedConflictCount: 1,
      skippedAlreadyAtDestinationCount: 2,
      pendingCount: 3,
      heartbeatAt: '2026-11-16T05:00:00.000Z',
      failureReason: null,
      lastError: null,
      createdAt: '2026-11-16T04:00:00.000Z',
      updatedAt: '2026-11-16T05:00:00.000Z',
      completedAt: null,
    });
    expect(bulkMoveJobModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId, workspaceId, pipelineId },
      }),
    );
  });

  it('returns 404 when a job is not found in the requested tenant', async () => {
    bulkMoveJobModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunity-bulk-moves/${jobId}`)
      .set('X-Workspace-Id', workspaceId)
      .expect(404);

    expect(bulkMoveJobModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId, workspaceId, pipelineId },
      }),
    );
  });
});
