import { Test, TestingModule } from '@nestjs/testing';
import { AppLogger } from '../logging/app-logger';
import { POSTGRES_POOL } from './postgres.constants';
import { PostgresPoolLifecycle } from './postgres-pool-lifecycle';

describe('PostgresPoolLifecycle', () => {
  it('closes the shared pool during module shutdown', async () => {
    const pool = {
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostgresPoolLifecycle,
        { provide: POSTGRES_POOL, useValue: pool },
        { provide: AppLogger, useValue: { error: jest.fn() } },
      ],
    }).compile();

    await module.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
