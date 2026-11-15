import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { createPoolConfig } = require('../../database/seed.cjs');

describe('deterministic database seed', () => {
  it('defines reproducible small and performance-scale SQL datasets', () => {
    const seedSql = readFileSync(
      resolve(__dirname, '../../database/seed.sql'),
      'utf8',
    );
    const pipelineSizes = [
      ...seedSql.matchAll(
        /\('(?:main|secondary|small-\d)', '[^']+', (\d+), (\d+), (\d+)\)/g,
      ),
    ];

    expect(seedSql.match(/^-- seed-step$/gm)).toHaveLength(5);
    expect(seedSql).toContain("md5('seed-workspace:main')::uuid");
    expect(seedSql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(seedSql).toContain('generate_series(');
    expect(seedSql).toContain("TIMESTAMPTZ '2026-11-15 00:00:00+00'");
    expect(pipelineSizes).toHaveLength(7);
    expect(pipelineSizes[0][2]).toBe('500000');
    expect(pipelineSizes.slice(2).map((definition) => definition[2])).toEqual([
      '3000',
      '3000',
      '3000',
      '3000',
      '3000',
    ]);
  });

  it('validates database connection settings before seeding', () => {
    expect(() => createPoolConfig({})).toThrow('POSTGRES_USER must be set');
    expect(
      createPoolConfig({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
        POSTGRES_PORT: '5433',
      }),
    ).toMatchObject({ host: 'localhost', port: 5433, max: 1 });
  });
});
