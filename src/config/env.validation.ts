export interface ApplicationConfiguration {
  port: number;
  worker: {
    chunkSize: number;
    leaseMs: number;
    maxAttempts: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
    chunkPauseMs: number;
    pollMs: number;
  };
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolMax: number;
  };
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function parsePort(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

export function validateEnvironment(
  environment: NodeJS.ProcessEnv,
): ApplicationConfiguration {
  return {
    port: parsePort('PORT', environment.PORT, 3000),
    worker: {
      chunkSize: parseInteger(
        'BULK_MOVE_CHUNK_SIZE',
        environment.BULK_MOVE_CHUNK_SIZE,
        100,
        1,
        1000,
      ),
      leaseMs: parseInteger(
        'BULK_MOVE_LEASE_MS',
        environment.BULK_MOVE_LEASE_MS,
        30_000,
        1000,
        600_000,
      ),
      maxAttempts: parseInteger(
        'BULK_MOVE_MAX_ATTEMPTS',
        environment.BULK_MOVE_MAX_ATTEMPTS,
        8,
        1,
        100,
      ),
      backoffBaseMs: parseInteger(
        'BULK_MOVE_BACKOFF_BASE_MS',
        environment.BULK_MOVE_BACKOFF_BASE_MS,
        500,
        1,
        60_000,
      ),
      backoffMaxMs: parseInteger(
        'BULK_MOVE_BACKOFF_MAX_MS',
        environment.BULK_MOVE_BACKOFF_MAX_MS,
        60_000,
        1,
        600_000,
      ),
      chunkPauseMs: parseInteger(
        'BULK_MOVE_CHUNK_PAUSE_MS',
        environment.BULK_MOVE_CHUNK_PAUSE_MS,
        50,
        1,
        10_000,
      ),
      pollMs: parseInteger(
        'BULK_MOVE_POLL_MS',
        environment.BULK_MOVE_POLL_MS,
        500,
        10,
        60_000,
      ),
    },
    postgres: {
      host:
        environment.POSTGRES_HOST === undefined
          ? 'localhost'
          : requiredValue(environment, 'POSTGRES_HOST'),
      port: parsePort('POSTGRES_PORT', environment.POSTGRES_PORT, 5432),
      user: requiredValue(environment, 'POSTGRES_USER'),
      password: requiredValue(environment, 'POSTGRES_PASSWORD'),
      database: requiredValue(environment, 'POSTGRES_DB'),
      poolMax: parseInteger(
        'POSTGRES_POOL_MAX',
        environment.POSTGRES_POOL_MAX,
        9,
        1,
        100,
      ),
    },
  };
}
