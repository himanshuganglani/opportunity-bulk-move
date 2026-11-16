'use strict';

const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MAIN_WORKSPACE_ID = '574e3c74-ed85-87f0-e746-044b090bfd98';
const OPPORTUNITIES_PER_JOB = 50_000;

function parseOptions(argumentsList) {
  const options = {
    sourceStage: 1,
    destinationStage: 2,
    crashAt: null,
  };
  for (const argument of argumentsList) {
    if (argument === '--help') {
      console.log(
        'Usage: npm run benchmark -- [--source-stage=1..12] [--destination-stage=1..12] [--crash-at=committed-count]',
      );
      process.exit(0);
    }
    const [key, value] = argument.replace(/^--/, '').split('=');
    if (key === 'source-stage') options.sourceStage = Number(value);
    else if (key === 'destination-stage')
      options.destinationStage = Number(value);
    else if (key === 'crash-at') options.crashAt = Number(value);
    else throw new Error(`Unknown benchmark option: --${key}`);
  }
  if (
    !Number.isInteger(options.sourceStage) ||
    options.sourceStage < 1 ||
    options.sourceStage > 12 ||
    !Number.isInteger(options.destinationStage) ||
    options.destinationStage < 1 ||
    options.destinationStage > 12 ||
    options.sourceStage === options.destinationStage
  ) {
    throw new Error(
      'Source and destination stages must be different integers from 1 to 12.',
    );
  }
  if (
    options.crashAt !== null &&
    (!Number.isInteger(options.crashAt) ||
      options.crashAt < 1 ||
      options.crashAt >= OPPORTUNITIES_PER_JOB)
  ) {
    throw new Error(
      `--crash-at must be an integer between 1 and ${OPPORTUNITIES_PER_JOB - 1}.`,
    );
  }
  return options;
}

function percentile(samples, fraction) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
}

function summarizeLatency(samples, failures, durationMs) {
  const requestCount = samples.length + failures;
  return {
    requestCount,
    successfulRequests: samples.length,
    failedRequests: failures,
    durationMs: Number(durationMs.toFixed(2)),
    requestsPerSecond: Number(((requestCount * 1000) / durationMs).toFixed(2)),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    maxMs:
      samples.length === 0
        ? null
        : Number(
            samples.reduce((max, value) => Math.max(max, value), 0).toFixed(2),
          ),
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function createPool() {
  const required = [
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'BENCHMARK_DATABASE_NAME',
  ];
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`${name} must be set before running the benchmark`);
    }
  }
  return new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.BENCHMARK_DATABASE_NAME,
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
}

async function loadSeedIds(pool, sourceStage, destinationStage) {
  const { rows } = await pool.query(
    `SELECT
       md5('seed-pipeline:main')::uuid::text AS pipeline_id,
       md5('seed-pipeline:small-1')::uuid::text AS other_pipeline_id,
       md5('seed-stage:main:' || $1::text)::uuid::text AS source_stage_id,
       md5('seed-stage:main:' || $2::text)::uuid::text AS destination_stage_id,
       md5('seed-stage:small-1:1')::uuid::text AS other_stage_id,
       md5('seed-workspace:small-1')::uuid::text AS other_workspace_id`,
    [sourceStage, destinationStage],
  );
  return rows[0];
}

async function tagBenchmarkRecords(
  pool,
  pipelineId,
  sourceStageId,
  destinationStageId,
  ownerId,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH selected AS (
         SELECT id
         FROM opportunities
         WHERE workspace_id = $1
           AND pipeline_id = $2
           AND stage_id = $3
           AND name LIKE 'Seed Opportunity %'
           AND owner_id LIKE 'seed-owner-%'
         ORDER BY id
         LIMIT $4
       )
       UPDATE opportunities AS opportunity
       SET owner_id = $5
       FROM selected
       WHERE opportunity.id = selected.id
         AND opportunity.workspace_id = $1
         AND opportunity.pipeline_id = $2
       RETURNING opportunity.id`,
      [
        MAIN_WORKSPACE_ID,
        pipelineId,
        sourceStageId,
        OPPORTUNITIES_PER_JOB,
        ownerId,
      ],
    );
    if (rows.length !== OPPORTUNITIES_PER_JOB) {
      throw new Error(
        `Could tag only ${rows.length} untouched seeded records in source stage ${sourceStageId}; 50,000 are required.`,
      );
    }

    const opportunityIds = rows.map((row) => row.id);
    const { rows: transitionCounts } = await client.query(
      `SELECT
         selected.opportunity_id,
         COUNT(transition.id) FILTER (
           WHERE transition.from_stage_id = $4
             AND transition.to_stage_id = $5
         )::integer AS transition_count
       FROM unnest($1::uuid[]) AS selected(opportunity_id)
       LEFT JOIN stage_transitions AS transition
         ON transition.workspace_id = $2
        AND transition.pipeline_id = $3
        AND transition.opportunity_id = selected.opportunity_id
       GROUP BY selected.opportunity_id`,
      [
        opportunityIds,
        MAIN_WORKSPACE_ID,
        pipelineId,
        sourceStageId,
        destinationStageId,
      ],
    );
    await client.query('COMMIT');
    return transitionCounts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyResult(
  pool,
  jobId,
  ownerId,
  pipelineId,
  sourceStageId,
  destinationStageId,
  initialTransitionCounts,
) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::integer AS snapshot_count,
       COUNT(*) FILTER (WHERE item.outcome = 'moved')::integer AS moved_count,
       COUNT(*) FILTER (WHERE item.outcome = 'skipped_conflict')::integer AS conflict_count,
       COUNT(*) FILTER (WHERE item.outcome = 'skipped_already_at_destination')::integer AS already_at_destination_count,
       COUNT(*) FILTER (
         WHERE opportunity.id IS NULL
           OR opportunity.owner_id <> $2
           OR opportunity.pipeline_id <> $3
       )::integer AS benchmark_membership_mismatch,
       COUNT(*) FILTER (
         WHERE item.outcome = 'moved'
           AND opportunity.stage_id <> $5
       )::integer AS moved_records_in_wrong_stage,
       COUNT(*) FILTER (
         WHERE item.outcome = 'moved'
           AND (
             initial.opportunity_id IS NULL
             OR transition_counts.transition_count - initial.transition_count <> 1
           )
       )::integer AS moved_records_without_exactly_one_transition
     FROM bulk_move_items AS item
     LEFT JOIN opportunities AS opportunity
       ON opportunity.workspace_id = item.workspace_id
      AND opportunity.pipeline_id = item.pipeline_id
      AND opportunity.id = item.opportunity_id
     LEFT JOIN jsonb_to_recordset($6::jsonb)
       AS initial(opportunity_id uuid, transition_count integer)
       ON initial.opportunity_id = item.opportunity_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::integer AS transition_count
       FROM stage_transitions AS transition
       WHERE transition.workspace_id = item.workspace_id
         AND transition.pipeline_id = item.pipeline_id
         AND transition.opportunity_id = item.opportunity_id
         AND transition.from_stage_id = $4
         AND transition.to_stage_id = $5
     ) AS transition_counts ON true
     WHERE item.job_id = $1
       AND item.pipeline_id = $3
       `,
    [
      jobId,
      ownerId,
      pipelineId,
      sourceStageId,
      destinationStageId,
      JSON.stringify(initialTransitionCounts),
    ],
  );
  const result = rows[0];
  if (
    result.snapshot_count !== OPPORTUNITIES_PER_JOB ||
    result.moved_count !== OPPORTUNITIES_PER_JOB ||
    result.conflict_count !== 0 ||
    result.already_at_destination_count !== 0 ||
    result.benchmark_membership_mismatch !== 0 ||
    result.moved_records_in_wrong_stage !== 0 ||
    result.moved_records_without_exactly_one_transition !== 0
  ) {
    throw new Error(
      `Benchmark correctness check failed: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

function runCompose(...argumentsList) {
  const result = spawnSync('docker', ['compose', ...argumentsList], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker compose ${argumentsList.join(' ')} failed.`);
  }
}

function runDocker(...argumentsList) {
  const result = spawnSync('docker', argumentsList, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${argumentsList.join(' ')} failed.`);
  }
  return result.stdout.trim();
}

async function killAndRestartWorker(afterStopped) {
  const containerId = runDocker('compose', 'ps', '-q', 'worker');
  if (!containerId)
    throw new Error('Could not find the Compose worker container.');

  runDocker('update', '--restart=no', containerId);
  let exited = false;
  let restarted = false;
  try {
    runCompose('kill', '--signal', 'SIGKILL', 'worker');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (
        runDocker('inspect', '--format={{.State.Running}}', containerId) ===
        'false'
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (
      runDocker('inspect', '--format={{.State.Running}}', containerId) !==
      'false'
    ) {
      throw new Error('Worker container did not exit after SIGKILL.');
    }
    exited = true;

    const stoppedState = await afterStopped();
    runCompose('start', 'worker');
    if (
      runDocker('inspect', '--format={{.State.Running}}', containerId) !==
      'true'
    ) {
      throw new Error(
        'Worker container did not start after the explicit restart.',
      );
    }
    restarted = true;
    return stoppedState;
  } finally {
    if (exited && !restarted) runCompose('start', 'worker');
    runDocker('update', '--restart=unless-stopped', containerId);
  }
}

function assertSafeBenchmarkTarget(apiUrl) {
  const databaseName = process.env.BENCHMARK_DATABASE_NAME;
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const databaseHost = process.env.POSTGRES_HOST || 'localhost';

  if (process.env.BENCHMARK_ALLOW_DATA_MUTATION !== 'YES') {
    throw new Error(
      'This benchmark tags and moves 50,000 seeded opportunities. Set BENCHMARK_ALLOW_DATA_MUTATION=YES only when you intend to mutate the configured local database.',
    );
  }
  if (!databaseName) {
    throw new Error('BENCHMARK_DATABASE_NAME must be set in .env');
  }
  if (!loopbackHosts.has(databaseHost)) {
    throw new Error(
      'Benchmark database host must be localhost or a loopback address.',
    );
  }
  if (!loopbackHosts.has(new URL(apiUrl).hostname)) {
    throw new Error(
      'Benchmark API URL must use localhost or a loopback address.',
    );
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const apiUrl = (
    process.env.BENCHMARK_API_URL || 'http://localhost:3000'
  ).replace(/\/$/, '');
  assertSafeBenchmarkTarget(apiUrl);
  const concurrencyPerWorkspace = Number(
    process.env.BENCHMARK_CONCURRENCY_PER_WORKSPACE || 2,
  );
  if (
    !Number.isInteger(concurrencyPerWorkspace) ||
    concurrencyPerWorkspace < 1 ||
    concurrencyPerWorkspace > 32
  ) {
    throw new Error(
      'BENCHMARK_CONCURRENCY_PER_WORKSPACE must be an integer from 1 to 32.',
    );
  }
  const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS || 1_800_000);
  const pool = createPool();
  const benchmarkRunId = randomUUID();
  const ownerId = `benchmark-${benchmarkRunId}`;
  let loadEnabled = false;
  const latency = {
    sameWorkspace: { samples: [], failures: 0 },
    otherWorkspace: { samples: [], failures: 0 },
  };
  let loadTasks = [];

  try {
    await requestJson(`${apiUrl}/health/ready`);
    const { rows: databaseRows } = await pool.query(
      'SELECT current_database() AS name',
    );
    if (databaseRows[0].name !== process.env.BENCHMARK_DATABASE_NAME) {
      throw new Error(
        `Connected to database "${databaseRows[0].name}", not the expected benchmark database.`,
      );
    }
    const seedIds = await loadSeedIds(
      pool,
      options.sourceStage,
      options.destinationStage,
    );
    const initialTransitionCounts = await tagBenchmarkRecords(
      pool,
      seedIds.pipeline_id,
      seedIds.source_stage_id,
      seedIds.destination_stage_id,
      ownerId,
    );

    const interactiveTargets = [
      {
        key: 'sameWorkspace',
        workspaceId: MAIN_WORKSPACE_ID,
        pipelineId: seedIds.pipeline_id,
        stageId: seedIds.source_stage_id,
      },
      {
        key: 'otherWorkspace',
        workspaceId: seedIds.other_workspace_id,
        pipelineId: seedIds.other_pipeline_id,
        stageId: seedIds.other_stage_id,
      },
    ];

    const loadStartedAt = performance.now();
    loadEnabled = true;
    loadTasks = interactiveTargets.flatMap((target) =>
      Array.from({ length: concurrencyPerWorkspace }, async () => {
        while (loadEnabled) {
          const startedAt = performance.now();
          try {
            await requestJson(
              `${apiUrl}/pipelines/${target.pipelineId}/opportunities?stageId=${target.stageId}&limit=10`,
              { headers: { 'X-Workspace-Id': target.workspaceId } },
            );
            latency[target.key].samples.push(performance.now() - startedAt);
          } catch {
            latency[target.key].failures += 1;
          }
        }
      }),
    );

    const startDate = new Date();
    const startedAt = performance.now();
    const bulkMovesUrl = `${apiUrl}/pipelines/${seedIds.pipeline_id}/opportunity-bulk-moves`;
    const submission = await requestJson(bulkMovesUrl, {
      method: 'POST',
      headers: {
        'X-Workspace-Id': MAIN_WORKSPACE_ID,
        'Idempotency-Key': `benchmark-${benchmarkRunId}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destinationStageId: seedIds.destination_stage_id,
        filters: { stageId: seedIds.source_stage_id, ownerId },
      }),
    });
    if (!submission.jobId) throw new Error('Submission returned no jobId.');

    let crashInjectedAt = null;
    let committedAtCrash = null;
    let progress;
    const deadline = startedAt + timeoutMs;
    while (performance.now() < deadline) {
      progress = await requestJson(`${bulkMovesUrl}/${submission.jobId}`, {
        headers: { 'X-Workspace-Id': MAIN_WORKSPACE_ID },
      });
      const committed =
        progress.movedCount +
        progress.skippedConflictCount +
        progress.skippedAlreadyAtDestinationCount;
      if (
        options.crashAt !== null &&
        crashInjectedAt === null &&
        committed >= options.crashAt &&
        progress.status === 'running'
      ) {
        crashInjectedAt = performance.now();
        committedAtCrash = await killAndRestartWorker(async () => {
          const stoppedProgress = await requestJson(
            `${bulkMovesUrl}/${submission.jobId}`,
            { headers: { 'X-Workspace-Id': MAIN_WORKSPACE_ID } },
          );
          if (
            stoppedProgress.status === 'completed' ||
            stoppedProgress.status === 'failed'
          ) {
            throw new Error(
              `Worker stopped after the job became ${stoppedProgress.status}; crash recovery was not exercised.`,
            );
          }
          return (
            stoppedProgress.movedCount +
            stoppedProgress.skippedConflictCount +
            stoppedProgress.skippedAlreadyAtDestinationCount
          );
        });
      }
      if (progress.status === 'failed') {
        throw new Error(
          `Job failed: ${progress.failureReason} ${progress.lastError ?? ''}`,
        );
      }
      if (progress.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (progress?.status !== 'completed') {
      throw new Error(`Benchmark job exceeded ${timeoutMs}ms timeout.`);
    }
    if (options.crashAt !== null && crashInjectedAt === null) {
      throw new Error(
        'The job completed before the requested worker crash point was observed; rerun with a lower --crash-at threshold.',
      );
    }
    const jobCompletedAt = performance.now();
    const jobCompletedDate = new Date();
    loadEnabled = false;
    await Promise.all(loadTasks);
    const loadDurationMs = performance.now() - loadStartedAt;
    if (progress.snapshotCount !== OPPORTUNITIES_PER_JOB) {
      throw new Error(
        `Expected a 50,000-item submission snapshot, received ${progress.snapshotCount}.`,
      );
    }

    const elapsedMs = jobCompletedAt - startedAt;
    const correctness = await verifyResult(
      pool,
      submission.jobId,
      ownerId,
      seedIds.pipeline_id,
      seedIds.source_stage_id,
      seedIds.destination_stage_id,
      initialTransitionCounts,
    );
    const report = {
      startedAt: startDate.toISOString(),
      completedAt: jobCompletedDate.toISOString(),
      runId: benchmarkRunId,
      mode: options.crashAt === null ? 'uninterrupted' : 'kill-and-resume',
      jobId: submission.jobId,
      benchmarkOwnerId: ownerId,
      workspaceId: MAIN_WORKSPACE_ID,
      pipelineId: seedIds.pipeline_id,
      sourceStageId: seedIds.source_stage_id,
      destinationStageId: seedIds.destination_stage_id,
      differentWorkspace: {
        workspaceId: seedIds.other_workspace_id,
        pipelineId: seedIds.other_pipeline_id,
        stageId: seedIds.other_stage_id,
      },
      requestedCrashAtCommittedItems: options.crashAt,
      committedItemsAtCrash: committedAtCrash,
      crashToCompletionMs:
        crashInjectedAt === null
          ? null
          : Number((jobCompletedAt - crashInjectedAt).toFixed(2)),
      snapshotSize: progress.snapshotCount,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      throughputOpportunitiesPerSecond: Number(
        ((correctness.moved_count * 1000) / elapsedMs).toFixed(2),
      ),
      finalStatus: progress.status,
      outcomes: correctness,
      interactiveLatency: {
        concurrencyPerWorkspace,
        methodology:
          'Closed-loop GET list workload: each client sends its next request immediately after the previous response; rates use total attempts over the shared load interval, and latency percentiles use successful responses only.',
        sameWorkspace: summarizeLatency(
          latency.sameWorkspace.samples,
          latency.sameWorkspace.failures,
          loadDurationMs,
        ),
        differentWorkspace: summarizeLatency(
          latency.otherWorkspace.samples,
          latency.otherWorkspace.failures,
          loadDurationMs,
        ),
      },
      hardware: {
        platform: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        totalMemoryBytes: os.totalmem(),
        nodeVersion: process.version,
        workerConfig: {
          chunkSize:
            process.env.BULK_MOVE_CHUNK_SIZE || '100 (Compose default)',
          leaseMs: process.env.BULK_MOVE_LEASE_MS || '30000 (Compose default)',
          maxAttempts:
            process.env.BULK_MOVE_MAX_ATTEMPTS || '8 (Compose default)',
          chunkPauseMs:
            process.env.BULK_MOVE_CHUNK_PAUSE_MS || '50 (Compose default)',
          pollMs: process.env.BULK_MOVE_POLL_MS || '500 (Compose default)',
        },
      },
    };

    console.log(JSON.stringify(report, null, 2));
    if (process.env.BENCHMARK_OUTPUT) {
      const fs = require('node:fs');
      const outputPath = path.resolve(process.env.BENCHMARK_OUTPUT);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    loadEnabled = false;
    await Promise.allSettled(loadTasks);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
