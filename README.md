# Opportunity Bulk Move

Backend take-home project built with NestJS, TypeScript, and PostgreSQL.

## Implemented scope

This implementation includes:

- PostgreSQL runs as a Docker Compose service with a persistent volume and a
  `pg_isready` container health check.
- Sequelize is configured as the application's PostgreSQL ORM with schema
  synchronization disabled. Its pool is capped at nine connections; the
  separate health-check `pg` pool is capped at one. Sequelize CLI runs versioned
  CommonJS migrations.
- The initial migration creates the seven tenant-scoped domain tables,
  composite workspace/pipeline foreign keys, job/item state constraints, and
  indexes used for stage listing, job claims, and pending-item chunk reads.
- `src/common/database` owns the shared Sequelize connection pool. Nest
  lifecycle hooks close it on shutdown.
- `src/common/health` exposes `GET /health/live` as a process-only liveness
  probe and `GET /health/ready` as a PostgreSQL-backed readiness probe. The
  existing `GET /health` remains an alias for readiness. Readiness returns HTTP
  503 with a logged failure if PostgreSQL is unavailable.
- `src/common/logging` provides the shared Nest JSON logger without adding a
  third-party logging framework.
- Environment variables are validated at startup.

The API supports opportunity creation, paginated listing by stage, manual stage
moves with transition history, and bulk move submission/progress polling. The
separate worker claims jobs, processes bounded chunks, persists progress,
retries/resumes interrupted work, and records terminal outcomes. Deterministic
small and performance-scale seed commands are available. Runtime performance
measurements are not included.

## Requirements

- Node.js compatible with this repository's NestJS toolchain
- npm
- Docker Compose

## Start locally

```bash
cp -n .env.example .env
docker compose up
```

This starts PostgreSQL, applies migrations, seeds the small deterministic
dataset, and then starts the API and background worker. The API is available at
`http://localhost:3000`; Swagger UI is at
`http://localhost:3000/api/docs`. Compose uses the `postgres` service name for
container-to-container database connections. The `.env` file keeps the
`localhost` default for commands run directly on your machine. Compose builds
images when needed; use `docker compose up --build` to force a rebuild.

To run the test suite as well, use `npm run setup:test` in a separate terminal.
It starts PostgreSQL and runs migrations, seeding, build, and tests; it does not
replace the API/worker containers started by `docker compose up`.

Stop the application stack with `Ctrl-C`. To stop containers while preserving
the database volume, run `docker compose down`.

## Swagger / OpenAPI

When running with Compose, Swagger UI is available at
[http://localhost:3000/api/docs](http://localhost:3000/api/docs), and the
generated OpenAPI JSON is at
[http://localhost:3000/api/docs-json](http://localhost:3000/api/docs-json).
For local development without the API container, start PostgreSQL with
`docker compose up -d --wait postgres`, apply migrations and seed with
`npm run db:migrate && npm run db:seed:small`, then run `npm run start:dev`.
The same Swagger URLs work. In Postman, choose **Import**, then import the JSON
by URL or paste the `/api/docs-json` URL.

For local development, run the API and worker in separate terminals. The worker
defaults to a two-connection Sequelize pool (versus nine for the API), polls
for jobs, and processes bounded chunks with a pause between chunks.

```bash
npm run start:worker
```

The worker process entry point is `src/worker.ts`; its module and implementation
remain grouped under `src/opportunities/bulk-moves/worker/`.

`BULK_MOVE_CHUNK_SIZE`, `BULK_MOVE_LEASE_MS`, `BULK_MOVE_MAX_ATTEMPTS`,
`BULK_MOVE_BACKOFF_BASE_MS`, `BULK_MOVE_BACKOFF_MAX_MS`,
`BULK_MOVE_CHUNK_PAUSE_MS`, and `BULK_MOVE_POLL_MS` configure the worker.
Defaults and validation limits are in `src/config/env.validation.ts`.
`POSTGRES_POOL_MAX` can override the worker's pool cap when intentionally
configured.

An operator can requeue an exhausted job without rebuilding its submission-time
snapshot:

```bash
npm run jobs:resume -- --job-id <job-uuid>
```

Run the PostgreSQL integration suite directly after migrations have been
applied:

```bash
npm run test:integration -- --runInBand
```

`npm run db:migrate` loads the local `.env` and applies all pending migrations.
Use `npm run db:migrate:undo` to roll back the most recently applied migration.
The small seed is safe to rerun: it inserts deterministic IDs and does not
delete or overwrite existing records. For the performance dataset, after
migrations run:

```bash
npm run db:seed:large
```

The large seed creates one primary pipeline with 500,000 opportunities across
12 unevenly populated stages, with fixed creation dates spanning approximately
18 months; five separate workspaces receive 3,000 opportunities each. The main
workspace also has a secondary pipeline to exercise pipeline scoping. The small
seed creates the same topology with 100 primary-pipeline opportunities, 20
secondary-pipeline opportunities, and 25 opportunities in each of the five
other workspaces. Both seed modes use deterministic workspace, pipeline, stage,
and opportunity IDs; inserts are set-based in PostgreSQL and use conflict-safe
insertion. Seed data and distributions are in `database/seed.sql`; a small Node
runner selects the mode and executes that SQL with the configured PostgreSQL
connection, so `psql` is not required. The SQL seed prints each seeded
workspace, pipeline, and stage ID for API testing. On a clean database, the
small mode creates the small counts above; the large mode creates the
performance counts above. Switching from large back to small does not delete
or shrink data. The large seed is intentionally separate from default startup.

## Opportunity API

All opportunity routes require `X-Workspace-Id`. This header scopes tenant data
and is not authentication or authorization.

Create an opportunity with `POST /pipelines/:pipelineId/opportunities`:

```json
{
  "name": "Example opportunity",
  "value": "1250.00",
  "status": "open",
  "ownerId": "owner-1",
  "stageId": "a-stage-uuid"
}
```

List a pipeline stage with
`GET /pipelines/:pipelineId/opportunities?stageId=<uuid>&limit=50&cursor=<cursor>`.
`stageId` is required. The optional cursor is opaque and stable for records
ordered by creation timestamp and ID; the default page size is 50 and the
maximum is 100. Creation validates that the stage belongs to both the supplied
workspace and pipeline. Listing validates the same relationship and scopes the
opportunity query by workspace, pipeline, and stage.

Move an opportunity with
`PATCH /pipelines/:pipelineId/opportunities/:opportunityId/stage` and a JSON
body containing the destination `stageId`. The opportunity update and
`stage_transitions` insert commit together. Moving to its current stage is a
no-op and does not create a transition. The destination stage must already
belong to the same workspace and pipeline; use a stage ID printed by the seed
command or returned when listing opportunities. For the seeded main pipeline,
the `Contacted` stage ID is
`53ce639f-a428-3663-ecbd-721ca10e970d`. The generic Swagger UI UUID example is
not guaranteed to identify a stage in your database.

A `404 Destination stage not found in workspace and pipeline` means the
requested destination stage ID does not exist in this workspace and pipeline.
If the destination exists but the opportunity does not, the response is
`404 Opportunity not found in workspace`.

Submit a bulk move with
`POST /pipelines/:pipelineId/opportunity-bulk-moves`, an `Idempotency-Key`
header, and a body containing `destinationStageId` and optional filters:

```json
{
  "destinationStageId": "destination-stage-uuid",
  "filters": {
    "stageId": "source-stage-uuid",
    "ownerId": "owner-1",
    "status": "open",
    "minValue": "100.00",
    "maxValue": "5000.00",
    "createdFrom": "2026-01-01T00:00:00Z",
    "createdTo": "2026-02-01T00:00:00Z"
  }
}
```

The source `stageId` filter is optional. Monetary bounds are inclusive;
timestamps must be UTC, with `createdFrom` inclusive and `createdTo`
exclusive. A successful submission returns HTTP 202 and a durable `jobId`.
Retrying the same key and normalized request returns the same job; using that
key for a different request returns HTTP 422. Requests matching more than
50,000 opportunities also return HTTP 422. The job and its snapshot are created
atomically in PostgreSQL; this endpoint does not process the job.

Poll `GET /pipelines/:pipelineId/opportunity-bulk-moves/:jobId` for the
database-backed job status, snapshot/moved/skipped/pending counts, heartbeat,
failure details, and timestamps. The lookup is scoped by workspace, pipeline,
and job ID; a job outside that scope returns HTTP 404. Pending count is derived
from the persisted snapshot count minus the persisted terminal outcome counts,
so it reflects committed progress rather than a process-local counter.

The opportunities middleware validates `X-Workspace-Id` once and stores its
normalized UUID on the request. Controller pipes validate pipeline and
opportunity path UUIDs; service input checks return HTTP 400 for invalid
payloads, pagination values, cursors, or stage IDs. A stage or opportunity
outside the requested workspace and pipeline returns HTTP 404. Unexpected
database errors are not hidden: the transaction rolls back and Nest returns an
HTTP 500 response.

In another terminal, check liveness and readiness separately:

```bash
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health/ready
```

Liveness returns HTTP 200 without querying PostgreSQL:

```json
{ "status": "ok" }
```

Readiness returns HTTP 200 when PostgreSQL accepts a query:

```json
{ "status": "ok", "dependencies": { "postgres": "up" } }
```

The `.env` file is local-only and ignored by git. `.env.example` contains
development-only values; review it before creating a new `.env`, and replace
them if needed. Existing `.env` files are left untouched by the copy command.
The application defaults `POSTGRES_HOST` to `localhost`. The Compose health
check only checks that PostgreSQL is accepting connections. The application
readiness endpoint additionally authenticates and runs a query. Keep liveness
independent of PostgreSQL so a dependency outage does not cause orchestrators to
restart an otherwise healthy process; use readiness to stop routing traffic to
an instance that cannot serve requests.

Stop PostgreSQL while keeping its data volume:

```bash
docker compose down
```

## Verify

```bash
npm test -- --runInBand
npm run build
npm run lint
```

## Shared modules

`CommonModule` provides the Sequelize database module, health check, logging,
and PostgreSQL readiness pool. The Sequelize pool allows up to nine
connections; the separate health-check pool allows one.
