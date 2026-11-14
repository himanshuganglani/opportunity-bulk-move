import { Test, TestingModule } from '@nestjs/testing';
import { AppLogger } from '../logging/app-logger';
import { POSTGRES_POOL } from '../postgres/postgres.constants';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let pool: { query: jest.Mock };
  let logger: { error: jest.Mock };

  beforeEach(async () => {
    pool = { query: jest.fn() };
    logger = { error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: POSTGRES_POOL, useValue: pool },
        { provide: AppLogger, useValue: logger },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('reports the process as live without querying PostgreSQL', () => {
    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful PostgreSQL query', async () => {
    pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(controller.readiness()).resolves.toEqual({
      status: 'ok',
      dependencies: { postgres: 'up' },
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('logs readiness failure and reports PostgreSQL as unavailable', async () => {
    const error = new Error('connection refused');
    pool.query.mockRejectedValue(error);

    await expect(controller.readiness()).rejects.toMatchObject({
      status: 503,
      response: {
        status: 'error',
        dependencies: { postgres: 'down' },
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      'PostgreSQL readiness check failed',
      error.stack,
    );
  });
});
