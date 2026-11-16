import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  it('applies local port defaults and returns typed PostgreSQL settings', () => {
    expect(
      validateEnvironment({
        POSTGRES_USER: 'opportunity',
        POSTGRES_PASSWORD: 'local-only',
        POSTGRES_DB: 'opportunity_bulk_move',
      }),
    ).toEqual({
      port: 3000,
      worker: {
        chunkSize: 100,
        leaseMs: 30_000,
        maxAttempts: 8,
        backoffBaseMs: 500,
        backoffMaxMs: 60_000,
        chunkPauseMs: 50,
        pollMs: 500,
      },
      postgres: {
        host: 'localhost',
        port: 5432,
        user: 'opportunity',
        password: 'local-only',
        database: 'opportunity_bulk_move',
        poolMax: 9,
      },
    });
  });

  it('rejects missing credentials and invalid ports', () => {
    expect(() => validateEnvironment({})).toThrow('POSTGRES_USER must be set');
    expect(() =>
      validateEnvironment({
        POSTGRES_HOST: 'localhost',
        POSTGRES_USER: 'opportunity',
        POSTGRES_PASSWORD: 'local-only',
        POSTGRES_DB: 'opportunity_bulk_move',
        POSTGRES_PORT: '70000',
      }),
    ).toThrow('POSTGRES_PORT must be an integer between 1 and 65535');
  });
});
