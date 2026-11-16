# Opportunity Bulk Move

Backend take-home project built with NestJS, TypeScript, and PostgreSQL.

## Current setup

This phase provides the PostgreSQL foundation, opportunity creation and listing,
and deterministic seed data before implementing the bulk-move worker:

- PostgreSQL runs as a Docker Compose service with a persistent volume and a
  `pg_isready` container health check.
- Sequelize is configured as the application's PostgreSQL ORM with schema
  synchronization disabled. Its pool is capped at nine connections; the
  separate health-check `pg` pool is capped at one. Sequelize CLI runs versioned
  CommonJS migrations.
- The initial migration creates the seven tenant-scoped domain tables,
  composite workspace/pipeline foreign keys, job/item state constraints, and
  indexes used for stage listing, job claims, and pending-item chunk reads.
- `src/common/postgres` owns the shared PostgreSQL connection pool and closes it
  during application shutdown. The app enables Nest shutdown hooks so SIGINT
  and SIGTERM run lifecycle hooks and close the pool cleanly.
- `src/common/health` exposes `GET /health/live` as a process-only liveness
  probe and `GET /health/ready` as a PostgreSQL-backed readiness probe. The
  existing `GET /health` remains an alias for readiness. Readiness returns HTTP
  503 with a logged failure if PostgreSQL is unavailable.
- `src/common/logging` provides the shared Nest JSON logger without adding a
  third-party logging framework.
- Environment variables are validated at startup.

The current API supports opportunity creation, paginated listing by stage, and
manual stage moves with transition history. Deterministic small and
performance-scale seed commands are available. Bulk job
submission/processing and benchmarks are not implemented yet.

## Requirements

- Node.js compatible with this repository's NestJS toolchain
- npm
- Docker Compose

## Start locally

```bash
cp -n .env.example .env
docker compose up -d --wait postgres
npm install
npm run db:migrate
npm run db:seed:small
npm run start:dev
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
no-op and does not create a transition.

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
