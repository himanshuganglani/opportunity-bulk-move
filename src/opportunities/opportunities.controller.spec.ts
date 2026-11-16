import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import request from 'supertest';
import { App } from 'supertest/types';
import { Opportunity } from '../common/models/opportunity.model';
import { Stage } from '../common/models/stage.model';
import { StageTransition } from '../common/models/stage-transition.model';
import { WorkspaceMiddleware } from '../common/middleware/workspace.middleware';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pipelineId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondStageId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function opportunityRow(id: string, createdAt: string) {
  const row = {
    id,
    workspaceId,
    pipelineId,
    stageId,
    name: `Opportunity ${id}`,
    value: '1250.00',
    status: 'open',
    ownerId: 'owner-1',
    stageRevision: '0',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    cursorCreatedAt: createdAt,
  };
  const model = {
    ...row,
    get: (field: string) => row[field as keyof typeof row],
    update: jest.fn(async (values: Partial<typeof row>) => {
      Object.assign(row, values);
      Object.assign(model, values);
      return model;
    }),
  };
  return model;
}

describe('OpportunitiesController', () => {
  let app: INestApplication<App>;
  let sequelize: { transaction: jest.Mock };
  let stageModel: { findOne: jest.Mock };
  let opportunityModel: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
  };
  let stageTransitionModel: { create: jest.Mock };

  beforeEach(async () => {
    sequelize = {
      transaction: jest.fn(async (callback) =>
        callback({ id: 'transaction', LOCK: { UPDATE: 'UPDATE' } }),
      ),
    };
    stageModel = { findOne: jest.fn() };
    opportunityModel = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
    };
    stageTransitionModel = { create: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OpportunitiesController],
      providers: [
        OpportunitiesService,
        { provide: getConnectionToken(), useValue: sequelize },
        { provide: getModelToken(Stage), useValue: stageModel },
        { provide: getModelToken(Opportunity), useValue: opportunityModel },
        {
          provide: getModelToken(StageTransition),
          useValue: stageTransitionModel,
        },
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

  it('creates an opportunity scoped to the workspace and pipeline', async () => {
    const createdAt = '2026-11-15T12:00:00.123456Z';
    const createdOpportunity = opportunityRow(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      createdAt,
    );
    createdOpportunity.name = 'New opportunity';
    stageModel.findOne.mockResolvedValueOnce({ id: stageId });
    opportunityModel.create.mockResolvedValueOnce(createdOpportunity);

    const response = await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .send({
        name: 'New opportunity',
        value: '1250.00',
        status: 'open',
        ownerId: 'owner-1',
        stageId,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      workspaceId,
      pipelineId,
      stageId,
      name: 'New opportunity',
      value: '1250.00',
      status: 'open',
      ownerId: 'owner-1',
      stageRevision: 0,
    });
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(stageModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: stageId },
        transaction: expect.objectContaining({ id: 'transaction' }),
      }),
    );
    expect(opportunityModel.create).toHaveBeenCalledWith(
      {
        workspaceId,
        pipelineId,
        stageId,
        name: 'New opportunity',
        value: '1250.00',
        status: 'open',
        ownerId: 'owner-1',
      },
      { transaction: expect.objectContaining({ id: 'transaction' }) },
    );
  });

  it('requires a workspace header and a valid create payload', async () => {
    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunities`)
      .send({
        name: 'New opportunity',
        value: 'not-money',
        status: 'open',
        ownerId: 'owner-1',
        stageId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .send({
        name: 'New opportunity',
        value: 'not-money',
        status: 'open',
        ownerId: 'owner-1',
        stageId,
      })
      .expect(400);

    expect(stageModel.findOne).not.toHaveBeenCalled();
    expect(opportunityModel.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed workspace header before reaching the service', async () => {
    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', 'not-a-uuid')
      .query({ stageId })
      .expect(400);

    expect(stageModel.findOne).not.toHaveBeenCalled();
  });

  it('rejects malformed route UUIDs before reaching the service', async () => {
    const invalidPipelineResponse = await request(app.getHttpServer())
      .get('/pipelines/not-a-uuid/opportunities')
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId })
      .expect(400);

    expect(invalidPipelineResponse.body.message).toBe(
      'pipelineId must be a UUID in 8-4-4-4-12 hexadecimal format',
    );

    await request(app.getHttpServer())
      .patch(`/pipelines/${pipelineId}/opportunities/not-a-uuid/stage`)
      .set('X-Workspace-Id', workspaceId)
      .send({ stageId })
      .expect(400);

    expect(stageModel.findOne).not.toHaveBeenCalled();
    expect(opportunityModel.findOne).not.toHaveBeenCalled();
  });

  it('accepts deterministic database UUIDs without RFC version bits', async () => {
    const seededPipelineId = 'd8e4deb6-0e18-529f-d377-b72520490a64';
    const seededStageId = '0828f661-b889-3f78-0d8c-903029aa7f6c';
    stageModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get(`/pipelines/${seededPipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId: seededStageId })
      .expect(404);

    expect(stageModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId,
          pipelineId: seededPipelineId,
          id: seededStageId,
        },
      }),
    );
  });

  it('moves an opportunity and records the transition atomically', async () => {
    const opportunityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const opportunity = opportunityRow(
      opportunityId,
      '2026-11-15T12:00:00.123456Z',
    );
    stageModel.findOne.mockResolvedValueOnce({ id: secondStageId });
    opportunityModel.findOne.mockResolvedValueOnce(opportunity);
    stageTransitionModel.create.mockResolvedValueOnce({});

    const response = await request(app.getHttpServer())
      .patch(`/pipelines/${pipelineId}/opportunities/${opportunityId}/stage`)
      .set('X-Workspace-Id', workspaceId)
      .send({ stageId: secondStageId })
      .expect(200);

    expect(response.body).toMatchObject({
      id: opportunityId,
      workspaceId,
      pipelineId,
      stageId: secondStageId,
      stageRevision: 1,
    });
    expect(stageModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: secondStageId },
        transaction: expect.any(Object),
      }),
    );
    expect(opportunityModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: opportunityId },
        lock: 'UPDATE',
      }),
    );
    expect(opportunity.update).toHaveBeenCalledWith(
      { stageId: secondStageId, stageRevision: '1' },
      { transaction: { id: 'transaction', LOCK: { UPDATE: 'UPDATE' } } },
    );
    expect(stageTransitionModel.create).toHaveBeenCalledWith(
      {
        workspaceId,
        pipelineId,
        opportunityId,
        fromStageId: stageId,
        toStageId: secondStageId,
      },
      { transaction: { id: 'transaction', LOCK: { UPDATE: 'UPDATE' } } },
    );
  });

  it('does not create a transition for a move to the current stage', async () => {
    const opportunityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    stageModel.findOne.mockResolvedValueOnce({ id: stageId });
    opportunityModel.findOne.mockResolvedValueOnce(
      opportunityRow(opportunityId, '2026-11-15T12:00:00.123456Z'),
    );

    await request(app.getHttpServer())
      .patch(`/pipelines/${pipelineId}/opportunities/${opportunityId}/stage`)
      .set('X-Workspace-Id', workspaceId)
      .send({ stageId })
      .expect(200);

    expect(stageTransitionModel.create).not.toHaveBeenCalled();
  });

  it('does not move an opportunity to a stage outside the tenant pipeline', async () => {
    stageModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .patch(
        `/pipelines/${pipelineId}/opportunities/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/stage`,
      )
      .set('X-Workspace-Id', workspaceId)
      .send({ stageId: secondStageId })
      .expect(404)
      .expect({
        message: 'Destination stage not found in workspace and pipeline',
        error: 'Not Found',
        statusCode: 404,
      });

    expect(opportunityModel.findOne).not.toHaveBeenCalled();
    expect(stageTransitionModel.create).not.toHaveBeenCalled();
  });

  it('returns not found when the opportunity is outside the tenant pipeline', async () => {
    const opportunityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    stageModel.findOne.mockResolvedValueOnce({ id: secondStageId });
    opportunityModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .patch(`/pipelines/${pipelineId}/opportunities/${opportunityId}/stage`)
      .set('X-Workspace-Id', workspaceId)
      .send({ stageId: secondStageId })
      .expect(404);

    expect(opportunityModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: opportunityId },
      }),
    );
    expect(stageTransitionModel.create).not.toHaveBeenCalled();
  });

  it('rejects stages outside the requested workspace and pipeline', async () => {
    stageModel.findOne.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .post(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .send({
        name: 'New opportunity',
        value: '1250.00',
        status: 'open',
        ownerId: 'owner-1',
        stageId: secondStageId,
      })
      .expect(404);

    expect(stageModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: secondStageId },
      }),
    );
    expect(opportunityModel.create).not.toHaveBeenCalled();
  });

  it('lists a required stage in stable pages with workspace scoping', async () => {
    const first = opportunityRow(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '2026-11-15T12:00:00.123456Z',
    );
    const second = opportunityRow(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '2026-11-15T12:00:00.123456Z',
    );
    stageModel.findOne.mockResolvedValueOnce({ id: stageId });
    opportunityModel.findAll.mockResolvedValueOnce([first, second]);

    const firstPage = await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId, limit: 1 })
      .expect(200);

    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.data[0].id).toBe(first.id);
    expect(firstPage.body.limit).toBe(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    expect(opportunityModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId, pipelineId, stageId }),
        order: expect.arrayContaining([
          [expect.objectContaining({ col: 'Opportunity.created_at' }), 'ASC'],
          [expect.objectContaining({ col: 'Opportunity.id' }), 'ASC'],
        ]),
        limit: 2,
      }),
    );

    stageModel.findOne.mockResolvedValueOnce({ id: stageId });
    opportunityModel.findAll.mockResolvedValueOnce([second]);
    const secondPage = await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId, limit: 1, cursor: firstPage.body.nextCursor })
      .expect(200);

    expect(secondPage.body.data[0].id).toBe(second.id);
    expect(secondPage.body.nextCursor).toBeNull();
    const secondPageWhere = opportunityModel.findAll.mock.calls[1][0].where;
    expect(secondPageWhere[Op.and][0].val).toContain(
      `TIMESTAMPTZ '${first.cursorCreatedAt}'`,
    );
    expect(secondPageWhere[Op.and][0].val).toContain(`UUID '${first.id}'`);
  });

  it('requires stageId and rejects a stage not in the tenant pipeline', async () => {
    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .expect(400);

    stageModel.findOne.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId: secondStageId })
      .expect(404);

    expect(stageModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId, pipelineId, id: secondStageId },
      }),
    );
  });

  it('rejects malformed cursors before building a model query', async () => {
    const invalidCursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-11-15T12:00:00.123456Z',
        id: "' OR TRUE --",
      }),
    ).toString('base64url');

    await request(app.getHttpServer())
      .get(`/pipelines/${pipelineId}/opportunities`)
      .set('X-Workspace-Id', workspaceId)
      .query({ stageId, cursor: invalidCursor })
      .expect(400);

    expect(stageModel.findOne).not.toHaveBeenCalled();
    expect(opportunityModel.findAll).not.toHaveBeenCalled();
  });
});
