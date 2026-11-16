# Opportunity Bulk Move

A NestJS and PostgreSQL backend for workspace- and pipeline-scoped opportunities,
including an asynchronous bulk stage move of up to 50,000 matching records.

## What is implemented

- Create, stage-list, and manually move opportunities. Manual moves write a
  stage transition in the same transaction.
- Submit an idempotent bulk move and poll its database-backed progress.
- Snapshot matching opportunity IDs and stage revisions when a job is submitted.
  The worker processes pending items in bounded PostgreSQL transactions and
  records each item's result.
- Detect conflicting manual stage edits; persist moved, conflict, and
  already-at-destination outcomes.
- Retry and recover jobs from PostgreSQL state after worker interruption.
- Deterministic additive small and large seed modes.

`X-Workspace-Id` selects a workspace; it is not authentication or authorization.
The API and worker are separate processes. PostgreSQL is their durable job
coordination store; there is no Redis, Kafka, or external queue.

For schema, transaction, lease, and concurrency details, see
[DESIGN.md](./DESIGN.md). Measured performance results and methodology are in
[BENCHMARKS.md](./BENCHMARKS.md), with the source reports at
[uninterrupted.json](./benchmark-results/uninterrupted.json) and
[kill-resume.json](./benchmark-results/kill-resume.json).

## Technology and prerequisites

- Node.js: use Node 24 to match the `node:24-alpine` Docker build image. The
  package does not declare an `engines` minimum.
- npm, for local installation and scripts.
- Docker with the Docker Compose v2 plugin, for PostgreSQL and the Compose
  application stack.

The database image is `postgres:16-alpine`. The API uses NestJS,
Sequelize/Sequelize CLI, and PostgreSQL; tests use Jest and Supertest.

## Database modes and environment

Development and benchmark data use **two logical databases on the same
PostgreSQL Compose service and persistent volume**, not two PostgreSQL servers:

| Mode                           | Database              | Use                                |
| ------------------------------ | --------------------- | ---------------------------------- |
| Recommended normal development | `opportunity_move_db` | API, worker, small seed, and tests |
| Benchmark                      | `opportunity_db`      | Large seed and benchmark runs      |

Compose also defaults to `opportunity_move_db` if `POSTGRES_DB` is unset.
Compose's `POSTGRES_DB` selects the database used by the API, worker, and
`initialize` service. The benchmark runner's direct SQL connection uses
`BENCHMARK_DATABASE_NAME`. During a benchmark, both must target
`opportunity_db`; pass the Compose override to the whole stack, not just one
service.

**Important:** the checked-in `.env.example` currently contains benchmark
settings, including `POSTGRES_DB=opportunity_db` and
`BENCHMARK_ALLOW_DATA_MUTATION=YES`. Do not copy and use it unchanged for normal
development. Before starting anything, create or edit the ignored `.env` so
normal development uses a separate database and benchmark mutation is opt-in.
For example:

```dotenv
POSTGRES_USER=opportunity_user
POSTGRES_PASSWORD=local-development-only
POSTGRES_DB=opportunity_move_db
POSTGRES_PORT=5432
BENCHMARK_DATABASE_NAME=opportunity_db
BENCHMARK_ALLOW_DATA_MUTATION=NO
```

Replace the example password with a local-only value. Do not use these
development credentials outside a disposable local environment. The
application defaults `POSTGRES_HOST` to `localhost` for commands run on the
host; Compose sets it to `postgres` inside its containers. Worker settings can
be omitted to use the defaults below.

| Variable                        | Default or requirement                                                        | Purpose                       |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `POSTGRES_USER`                 | Required; Compose fallback is `opportunity`                                   | PostgreSQL role               |
| `POSTGRES_PASSWORD`             | Required; Compose fallback is `local-development-only`                        | PostgreSQL password           |
| `POSTGRES_DB`                   | `opportunity_move_db` for normal development; `opportunity_db` for benchmarks | Database used by app services |
| `POSTGRES_HOST`                 | `localhost` on host; Compose uses `postgres`                                  | PostgreSQL host               |
| `POSTGRES_PORT`                 | `5432`                                                                        | PostgreSQL port               |
| `PORT`                          | `3000`                                                                        | API listening port            |
| `POSTGRES_POOL_MAX`             | API default `9`; Compose worker default `2`                                   | Sequelize pool maximum        |
| `BULK_MOVE_CHUNK_SIZE`          | `100`                                                                         | Items per worker chunk        |
| `BULK_MOVE_LEASE_MS`            | `30000`                                                                       | Lease duration                |
| `BULK_MOVE_MAX_ATTEMPTS`        | `8`                                                                           | Worker attempt limit          |
| `BULK_MOVE_BACKOFF_BASE_MS`     | `500`                                                                         | Retry backoff base            |
| `BULK_MOVE_BACKOFF_MAX_MS`      | `60000`                                                                       | Retry backoff cap             |
| `BULK_MOVE_CHUNK_PAUSE_MS`      | `50`                                                                          | Pause between chunks          |
| `BULK_MOVE_POLL_MS`             | `500`                                                                         | Worker polling interval       |
| `BENCHMARK_DATABASE_NAME`       | Required by benchmark runner; set to `opportunity_db` for benchmark           | Direct SQL target             |
| `BENCHMARK_ALLOW_DATA_MUTATION` | Must explicitly be `YES` to run benchmark                                     | Mutation safety opt-in        |

The worker configuration ranges are validated at startup; details are in
[`src/config/env.validation.ts`](./src/config/env.validation.ts). `.env` is
ignored by Git.

## Local setup: Docker Compose

1. Make sure `.env` is set up as described above, with
   `POSTGRES_DB=opportunity_move_db` and benchmark mutation disabled.
2. From the repository root, build and start the complete stack:

   ```bash
   docker compose up --build -d --wait
   ```

Compose starts PostgreSQL, waits for its health check, then runs the
`initialize` service. That service applies pending migrations and runs
`db:seed:small`; only after it succeeds do the API and worker start. The small
seed is deterministic, additive, and safe to rerun. Normal startup does not
run the large seed.

3. Check API liveness and PostgreSQL readiness:

   ```bash
   curl -i http://localhost:3000/health/live
   curl -i http://localhost:3000/health/ready
   ```

   Liveness checks only that the API process responds. Readiness also queries
   PostgreSQL. There is no worker HTTP health endpoint; check that it is running
   and inspect its startup log:

   ```bash
   docker compose ps worker
   docker compose logs worker
   ```

The API listens at `http://localhost:3000`. Swagger UI is at
[http://localhost:3000/api/docs](http://localhost:3000/api/docs); OpenAPI JSON
is at [http://localhost:3000/api/docs-json](http://localhost:3000/api/docs-json).
Stop services with `docker compose down`; this preserves the database volume.

## Local setup: run Node processes on the host

Use the development `.env` above. These commands start PostgreSQL, apply
migrations, load the small seed, and build the application:

```bash
npm ci
docker compose up -d --wait postgres
npm run db:migrate
npm run db:seed:small
npm run build
```

Then run the API and worker in separate terminals:

```bash
npm run start:dev
```

```bash
npm run start:worker
```

Both host processes read `.env` and connect through `localhost`. The worker
logs `Bulk move worker process started` when its process starts; it does not
expose a health endpoint.

## Seed data and migrations

Compose automatically applies migrations and the small seed through
`initialize`. For host-run processes, run `npm run db:migrate` and
`npm run db:seed:small` yourself. The migration command applies pending
Sequelize CLI migrations; `npm run db:migrate:undo` rolls back the latest one.
The seed runner uses the PostgreSQL connection from `.env`; `psql` is not
required.

Seed modes are deterministic and additive (`ON CONFLICT DO NOTHING`):

- Small mode: 100 opportunities in the main workspace's primary pipeline, 20
  in its expansion pipeline, and 25 in each of five other workspaces.
- Large mode: 500,000 opportunities across 12 unevenly populated stages in the
  main pipeline, 100 in its expansion pipeline, and 3,000 in each of five other
  workspaces. Main-pipeline creation dates span about 18 months.

The seed runner prints workspace, pipeline, and ordered stage UUIDs for use
with the API. Rerunning a seed does not delete or restore rows that already
exist; in particular, rerunning the large seed does not undo stage moves made
by benchmarks.

## API

All opportunity and bulk-move endpoints require `X-Workspace-Id` containing a
workspace UUID. Replace `WORKSPACE_ID`, `PIPELINE_ID`, and stage/opportunity
UUID placeholders below with IDs printed by the seed command or returned by
the API. Requests are scoped to both workspace and pipeline.

### Create an opportunity

`POST /pipelines/:pipelineId/opportunities` returns `201` and the created
opportunity record.

```bash
curl -i -X POST "http://localhost:3000/pipelines/$PIPELINE_ID/opportunities" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example opportunity",
    "value": "1250.00",
    "status": "open",
    "ownerId": "owner-1",
    "stageId": "STAGE_ID"
  }'
```

Statuses are `open`, `won`, `lost`, and `abandoned`. Monetary values accept a
JSON number or decimal string with up to 16 integer and 2 fractional digits.

### Manually move an opportunity

`PATCH /pipelines/:pipelineId/opportunities/:opportunityId/stage` returns
`200` and the updated opportunity. The request body contains the destination
`stageId`; the stage update and transition history entry are atomic. Moving to
the current stage is a no-op and adds no transition.

```bash
curl -i -X PATCH \
  "http://localhost:3000/pipelines/$PIPELINE_ID/opportunities/$OPPORTUNITY_ID/stage" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"stageId":"DESTINATION_STAGE_ID"}'
```

### List opportunities in a stage

`GET /pipelines/:pipelineId/opportunities?stageId=<uuid>&limit=50&cursor=<cursor>`
returns `200` with `data`, `nextCursor`, and `limit`. `stageId` is required;
`limit` defaults to 50 and may be from 1 to 100. Follow `nextCursor` for the
next page; it is opaque.

```bash
curl -i \
  "http://localhost:3000/pipelines/$PIPELINE_ID/opportunities?stageId=$STAGE_ID&limit=50" \
  -H "X-Workspace-Id: $WORKSPACE_ID"
```

### Submit and poll a bulk move

`POST /pipelines/:pipelineId/opportunity-bulk-moves` requires
`Idempotency-Key`; it returns `202` with `{ "jobId": "...", "status":
"queued" }`. Optional filters are combined with AND: `stageId`, `ownerId`,
`status`, inclusive `minValue`/`maxValue`, inclusive `createdFrom`, and
exclusive `createdTo` (UTC timestamps). When a source `stageId` filter is
provided, it must differ from `destinationStageId`. A submission snapshots
membership; later filter changes do not change the job's item set. More than
50,000 matches, or reusing a key with a different normalized request, returns
`422`.

```bash
curl -i -X POST \
  "http://localhost:3000/pipelines/$PIPELINE_ID/opportunity-bulk-moves" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Idempotency-Key: example-move-001" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationStageId": "DESTINATION_STAGE_ID",
    "filters": {
      "stageId": "SOURCE_STAGE_ID",
      "ownerId": "owner-1",
      "status": "open",
      "minValue": "100.00",
      "maxValue": "5000.00",
      "createdFrom": "2026-01-01T00:00:00Z",
      "createdTo": "2026-02-01T00:00:00Z"
    }
  }'
```

Poll `GET /pipelines/:pipelineId/opportunity-bulk-moves/:jobId` with the same
workspace header. It returns `200` with persisted status, snapshot/moved/
skipped/pending counts, heartbeat, failure details, and timestamps. Job statuses
are `queued`, `running`, `retry_wait`, `completed`, and `failed`; recorded item
outcomes are `moved`, `skipped_conflict`, and
`skipped_already_at_destination`. A job outside the supplied workspace or
pipeline returns `404`.

```bash
curl -i \
  "http://localhost:3000/pipelines/$PIPELINE_ID/opportunity-bulk-moves/$JOB_ID" \
  -H "X-Workspace-Id: $WORKSPACE_ID"
```

Invalid headers, path IDs, or request fields generally return `400`; invalid or
out-of-scope resources return `404`. The workspace header is a tenant selector,
not an authentication mechanism.

## Tests

With the development `.env` configured and PostgreSQL available, install
dependencies, migrate, and seed before running the suites:

```bash
npm ci
docker compose up -d --wait postgres
npm run db:migrate
npm run db:seed:small
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run test:integration -- --runInBand
```

The PostgreSQL integration tests use the configured database and require the
migrations to be applied.

> **Warning:** Before running `npm run setup:test`, create and configure `.env`.
> The checked-in `.env.example` points to the benchmark database
> (`POSTGRES_DB=opportunity_db`) and enables destructive benchmark mutation
> (`BENCHMARK_ALLOW_DATA_MUTATION=YES`). `setup:test` copies that file if `.env`
> does not exist, so running it without first creating a safe `.env` can target
> the wrong database. For normal development, set `POSTGRES_DB=opportunity_move_db`
> and `BENCHMARK_ALLOW_DATA_MUTATION=NO`.

Once `.env` is configured, `npm run setup:test` runs `npm install`, starts
PostgreSQL, migrates, seeds small data, builds, and runs all three test suites.
It does not start the API or worker.

The suites cover:

- Unit/controller tests for normalized snapshot creation, the 50,000-item
  limit, idempotent retries, request validation, and workspace/pipeline-scoped
  progress.
- Opportunity API tests for tenant and pipeline scoping, atomic manual moves,
  and avoiding a transition when the destination is already the current stage.
- PostgreSQL submission integration test for concurrent same-key HTTP requests,
  verifying one durable job and one persisted snapshot item.
- PostgreSQL worker integration tests for stage changes after snapshot creation
  (including conflicts and already-at-destination outcomes), expired-lease
  recovery, retry exhaustion and explicit resume, preserving terminal item
  outcomes and counters, one running job per workspace under concurrent claims,
  waiting on locked opportunities, and rejecting stale lease generations
  without writes or transitions.
- End-to-end tests for the root and liveness routes.

The regular test suites use small fixtures; the 50,000-item end-to-end
performance and kill/resume checks are run by the benchmark commands below,
not by `npm test`.

## Benchmarks

Benchmark data is a separate logical database, `opportunity_db`, on the same
PostgreSQL service and volume as development. The runner's direct SQL target is
`BENCHMARK_DATABASE_NAME`; the API and worker use `POSTGRES_DB`. Set
`BENCHMARK_DATABASE_NAME=opportunity_db` and apply `POSTGRES_DB=opportunity_db`
to the entire Compose stack, so all three connect to the intended database.
The benchmark runner also requires loopback database and API hosts.

### Prepare the benchmark database

1. Verify `.env` has the intended PostgreSQL user/password, a loopback
   `POSTGRES_HOST` (or leaves it unset for `localhost`), and
   `BENCHMARK_DATABASE_NAME=opportunity_db`. Keep mutation opt-in disabled
   except while deliberately running the benchmark.
2. Start the development Compose stack with its normal DB target first if
   PostgreSQL is not already running:

   ```bash
   docker compose up -d --wait postgres
   ```

   On a fresh PostgreSQL volume, the image creates only the database named by
   `POSTGRES_DB` at first initialization. If `opportunity_db` does not already
   exist in an initialized volume, create it once using the same role as
   `POSTGRES_USER` (replace `opportunity_user` if your `.env` uses a different
   role):

   ```bash
   docker compose exec -T postgres createdb -U opportunity_user opportunity_db
   ```

   Skip this command if the database already exists.

3. Start/recreate the whole stack with the benchmark database override. This
   runs migrations and the small seed in `opportunity_db`, but does not run the
   large seed:

   ```bash
   POSTGRES_DB=opportunity_db docker compose up -d --build --force-recreate --wait
   ```

4. If this benchmark database has not yet been large-seeded, add the performance
   dataset once:

   ```bash
   POSTGRES_DB=opportunity_db npm run db:seed:large
   ```

   If it is already seeded, skip this command. The seed is additive and does
   not reset records previously moved or retagged by benchmarks.

### Run a benchmark

The runner tags 50,000 untouched seeded records, submits a bulk job, and moves
those records. It refuses to run unless
`BENCHMARK_ALLOW_DATA_MUTATION=YES`, the database and API hosts are loopback,
and the connected database matches `BENCHMARK_DATABASE_NAME`. Set the
mutation variable to `YES` only for an intentional run against the disposable
benchmark database—not the development database. Benchmark preparation
changes the selected seeded records by tagging them, and the job moves them;
the seed is additive and does not restore prior stage assignments. Treat this
database as disposable and verify the target before opting in. The guard does
not prevent other local data loss if the wrong database is configured.

```bash
BENCHMARK_ALLOW_DATA_MUTATION=YES \
BENCHMARK_DATABASE_NAME=opportunity_db \
BENCHMARK_OUTPUT=benchmark-results/uninterrupted.json \
npm run benchmark -- --source-stage=1 --destination-stage=2

BENCHMARK_ALLOW_DATA_MUTATION=YES \
BENCHMARK_DATABASE_NAME=opportunity_db \
BENCHMARK_OUTPUT=benchmark-results/kill-resume.json \
npm run benchmark -- --source-stage=3 --destination-stage=4 --crash-at=30000
```

Stage numbers are one-based in the seeded main pipeline: 1 New Lead, 2
Contacted, 3 Qualified, 4 Discovery. The recovery command kills the Compose
worker with `SIGKILL`, verifies its exit, then explicitly restarts it. Each run
requires exactly 50,000 moved records with zero skips and verifies destination
stage, snapshot membership, and transition counts. Each source stage has finite
eligible seed capacity: successful runs move records out of that stage, and
rerunning the large seed does not restore them.

The runner defaults to two closed-loop list clients per workspace, API URL
`http://localhost:3000`, and a 30-minute timeout. Optional overrides are
`BENCHMARK_CONCURRENCY_PER_WORKSPACE` (1–32), `BENCHMARK_API_URL`,
`BENCHMARK_TIMEOUT_MS`, and `BENCHMARK_OUTPUT`. Without `BENCHMARK_OUTPUT`, the
JSON report is printed to stdout; when set, the path is resolved from the
current directory and parent directories are created. These JSON files are
generated report artifacts; the committed reports linked below document the
recorded runs and are not regenerated by the test suites.

### Recorded results

The committed local reports measured:

| Run             | 50k end-to-end time |   Effective throughput |
| --------------- | ------------------: | ---------------------: |
| Uninterrupted   |             73.45 s | 680.69 opportunities/s |
| Kill and resume |       99.63 s total | 501.87 opportunities/s |

The recovery helper-to-completion duration was 55.28 s; it is not exact
signal-to-completion time. Interactive latency percentiles, environment,
methodology, and correctness measurements are documented in
[BENCHMARKS.md](./BENCHMARKS.md). These local results are not a production
capacity or tenant-isolation guarantee.

After benchmarking, return API and worker to the development database from
`.env` by recreating the stack without the override:

```bash
docker compose up -d --build --force-recreate --wait
```

## Design trade-offs

Job submission synchronously materializes the snapshot in PostgreSQL before
returning `202`; this keeps membership stable but means filter/snapshot work is
part of request latency. The worker limits work by chunk size and pause, and
uses database leases, item outcomes, and transaction boundaries for recovery.
On concurrent edits, an opportunity whose stage or stage revision changed is
skipped as a conflict, unless it is already at the requested destination.
Authentication, authorization, a UI, and downstream event delivery are outside
the implemented scope. See [DESIGN.md](./DESIGN.md) for the full design.
