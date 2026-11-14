export interface ApplicationConfiguration {
  port: number;
  postgres: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
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

export function validateEnvironment(
  environment: NodeJS.ProcessEnv,
): ApplicationConfiguration {
  return {
    port: parsePort('PORT', environment.PORT, 3000),
    postgres: {
      host:
        environment.POSTGRES_HOST === undefined
          ? 'localhost'
          : requiredValue(environment, 'POSTGRES_HOST'),
      port: parsePort('POSTGRES_PORT', environment.POSTGRES_PORT, 5432),
      user: requiredValue(environment, 'POSTGRES_USER'),
      password: requiredValue(environment, 'POSTGRES_PASSWORD'),
      database: requiredValue(environment, 'POSTGRES_DB'),
    },
  };
}
