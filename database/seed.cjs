'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function createPoolConfig(environment = process.env) {
  const port = Number(environment.POSTGRES_PORT ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535');
  }
  for (const name of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    if (!environment[name] || environment[name].trim().length === 0) {
      throw new Error(`${name} must be set`);
    }
  }
  return {
    host: environment.POSTGRES_HOST?.trim() || 'localhost',
    port,
    user: environment.POSTGRES_USER,
    password: environment.POSTGRES_PASSWORD,
    database: environment.POSTGRES_DB,
    max: 1,
    connectionTimeoutMillis: 5_000,
  };
}

async function seed(mode) {
  if (!['small', 'large'].includes(mode)) {
    throw new Error('Usage: node database/seed.cjs <small|large>');
  }

  const sql = await fs.readFile(path.join(__dirname, 'seed.sql'), 'utf8');
  const statements = sql
    .split(/^-- seed-step\s*$/m)
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.length > 0 &&
        !statement
          .split('\n')
          .every(
            (line) => line.trim().length === 0 || line.trim().startsWith('--'),
          ),
    );
  if (statements.length !== 5) {
    throw new Error('database/seed.sql must contain five marked seed steps');
  }

  const pool = new Pool(createPoolConfig());
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await client.query(
          "SELECT set_config('opportunity.seed_mode', $1, true)",
          [mode],
        );
        for (const statement of statements.slice(0, -1)) {
          await client.query(statement);
        }
        const { rows } = await client.query(statements.at(-1));
        await client.query('COMMIT');

        for (const row of rows) {
          console.log(
            `${row.workspace_key}/${row.pipeline_key}: ${row.opportunity_count} opportunities ` +
              `(workspace=${row.workspace_id}, pipeline=${row.pipeline_id}, stages=${row.stage_ids.join(',')})`,
          );
        }
        console.log(`Seed mode "${mode}" completed (deterministic, additive).`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seed(process.argv[2]).catch((error) => {
    console.error('Database seeding failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { createPoolConfig, seed };
