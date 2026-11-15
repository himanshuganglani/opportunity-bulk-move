# Opportunity Bulk Move

Backend take-home project built with NestJS, TypeScript, and PostgreSQL.

## Current setup

This phase establishes shared infrastructure before designing the opportunity API
or bulk-move worker:

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

Opportunity endpoints, Sequelize domain models, bulk worker behavior, seeding,
and benchmarks are not implemented yet. They will follow the reviewed design
in short, verifiable steps.

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
npm run start:dev
```

`npm run db:migrate` loads the local `.env` and applies all pending migrations.
Use `npm run db:migrate:undo` to roll back the most recently applied migration.

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

Import `CommonModule` to reuse the PostgreSQL pool, health check, and logger in
future modules. The pool is capped at ten connections for now; revisit this
alongside the workload and connection budget during design review.
