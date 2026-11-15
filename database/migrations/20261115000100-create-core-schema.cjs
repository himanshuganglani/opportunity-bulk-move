'use strict';

const statements = [
  `CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE TABLE pipelines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (workspace_id, id)
  )`,
  `CREATE TABLE stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT stages_workspace_pipeline_fk
      FOREIGN KEY (workspace_id, pipeline_id)
      REFERENCES pipelines (workspace_id, id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, pipeline_id, id),
    UNIQUE (workspace_id, pipeline_id, position)
  )`,
  `CREATE TABLE opportunities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    pipeline_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    name text NOT NULL,
    value numeric(18, 2) NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'won', 'lost', 'abandoned')),
    owner_id text NOT NULL,
    stage_revision bigint NOT NULL DEFAULT 0 CHECK (stage_revision >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT opportunities_workspace_pipeline_fk
      FOREIGN KEY (workspace_id, pipeline_id)
      REFERENCES pipelines (workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT opportunities_workspace_pipeline_stage_fk
      FOREIGN KEY (workspace_id, pipeline_id, stage_id)
      REFERENCES stages (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, pipeline_id, id)
  )`,
  `CREATE TABLE stage_transitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    from_stage_id uuid NOT NULL,
    to_stage_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT stage_transitions_opportunity_fk
      FOREIGN KEY (workspace_id, pipeline_id, opportunity_id)
      REFERENCES opportunities (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT stage_transitions_from_stage_fk
      FOREIGN KEY (workspace_id, pipeline_id, from_stage_id)
      REFERENCES stages (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT stage_transitions_to_stage_fk
      FOREIGN KEY (workspace_id, pipeline_id, to_stage_id)
      REFERENCES stages (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CHECK (from_stage_id <> to_stage_id)
  )`,
  `CREATE TABLE bulk_move_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    pipeline_id uuid NOT NULL,
    destination_stage_id uuid NOT NULL,
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    request_hash char(64) NOT NULL
      CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    filters jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'running', 'retry_wait', 'completed', 'failed')),
    failure_reason text,
    snapshot_count integer NOT NULL DEFAULT 0 CHECK (snapshot_count >= 0),
    moved_count integer NOT NULL DEFAULT 0 CHECK (moved_count >= 0),
    skipped_conflict_count integer NOT NULL DEFAULT 0
      CHECK (skipped_conflict_count >= 0),
    skipped_already_at_destination_count integer NOT NULL DEFAULT 0
      CHECK (skipped_already_at_destination_count >= 0),
    lease_owner text,
    lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz,
    last_error text,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bulk_move_jobs_pipeline_fk
      FOREIGN KEY (workspace_id, pipeline_id)
      REFERENCES pipelines (workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT bulk_move_jobs_destination_stage_fk
      FOREIGN KEY (workspace_id, pipeline_id, destination_stage_id)
      REFERENCES stages (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT bulk_move_jobs_progress_within_snapshot_check
      CHECK (
        moved_count + skipped_conflict_count
        + skipped_already_at_destination_count <= snapshot_count
      ),
    CONSTRAINT bulk_move_jobs_lease_state_check
      CHECK (
        (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
      ),
    CONSTRAINT bulk_move_jobs_retry_state_check
      CHECK (
        (status = 'retry_wait' AND next_attempt_at IS NOT NULL)
        OR
        (status <> 'retry_wait' AND next_attempt_at IS NULL)
      ),
    CONSTRAINT bulk_move_jobs_failure_state_check
      CHECK (
        (status = 'failed' AND failure_reason IS NOT NULL)
        OR
        (status <> 'failed' AND failure_reason IS NULL)
      ),
    CONSTRAINT bulk_move_jobs_completion_state_check
      CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR
        (status <> 'completed' AND completed_at IS NULL)
      ),
    UNIQUE (workspace_id, idempotency_key),
    UNIQUE (workspace_id, pipeline_id, id)
  )`,
  `CREATE TABLE bulk_move_items (
    workspace_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    job_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    snapshot_stage_id uuid NOT NULL,
    snapshot_stage_revision bigint NOT NULL CHECK (snapshot_stage_revision >= 0),
    outcome text NOT NULL DEFAULT 'pending'
      CHECK (
        outcome IN (
          'pending',
          'moved',
          'skipped_conflict',
          'skipped_already_at_destination'
        )
      ),
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bulk_move_items_job_fk
      FOREIGN KEY (workspace_id, pipeline_id, job_id)
      REFERENCES bulk_move_jobs (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT bulk_move_items_opportunity_fk
      FOREIGN KEY (workspace_id, pipeline_id, opportunity_id)
      REFERENCES opportunities (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT bulk_move_items_snapshot_stage_fk
      FOREIGN KEY (workspace_id, pipeline_id, snapshot_stage_id)
      REFERENCES stages (workspace_id, pipeline_id, id) ON DELETE RESTRICT,
    CONSTRAINT bulk_move_items_processed_state_check
      CHECK (
        (outcome = 'pending' AND processed_at IS NULL)
        OR
        (outcome <> 'pending' AND processed_at IS NOT NULL)
      ),
    PRIMARY KEY (job_id, opportunity_id)
  )`,
];

const indexes = [
  `CREATE INDEX opportunities_stage_listing_idx
    ON opportunities (workspace_id, pipeline_id, stage_id, created_at, id)`,
  `CREATE INDEX bulk_move_jobs_claim_idx
    ON bulk_move_jobs (status, next_attempt_at, created_at)`,
  `CREATE UNIQUE INDEX uq_bulk_move_jobs_running_workspace
    ON bulk_move_jobs (workspace_id)
    WHERE status = 'running'`,
  `CREATE INDEX bulk_move_items_pending_chunk_idx
    ON bulk_move_items (job_id, outcome, opportunity_id)`,
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const statement of [...statements, ...indexes]) {
        await queryInterface.sequelize.query(statement, { transaction });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of [
        'bulk_move_items',
        'bulk_move_jobs',
        'stage_transitions',
        'opportunities',
        'stages',
        'pipelines',
        'workspaces',
      ]) {
        await queryInterface.dropTable(table, { transaction });
      }
    });
  },
};
