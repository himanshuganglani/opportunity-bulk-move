-- Idempotent seed data. database/seed.cjs sets the transaction-local
-- opportunity.seed_mode value and executes the marked statements in order.

-- seed-step
INSERT INTO workspaces (id, name)
VALUES
  (md5('seed-workspace:main')::uuid, 'Seed Main Workspace'),
  (md5('seed-workspace:small-1')::uuid, 'Seed Small Workspace 1'),
  (md5('seed-workspace:small-2')::uuid, 'Seed Small Workspace 2'),
  (md5('seed-workspace:small-3')::uuid, 'Seed Small Workspace 3'),
  (md5('seed-workspace:small-4')::uuid, 'Seed Small Workspace 4'),
  (md5('seed-workspace:small-5')::uuid, 'Seed Small Workspace 5')
ON CONFLICT (id) DO NOTHING;

-- seed-step
INSERT INTO pipelines (id, workspace_id, name)
VALUES
  (
    md5('seed-pipeline:main')::uuid,
    md5('seed-workspace:main')::uuid,
    'Primary Pipeline'
  ),
  (
    md5('seed-pipeline:secondary')::uuid,
    md5('seed-workspace:main')::uuid,
    'Expansion Pipeline'
  ),
  (
    md5('seed-pipeline:small-1')::uuid,
    md5('seed-workspace:small-1')::uuid,
    'Default Pipeline'
  ),
  (
    md5('seed-pipeline:small-2')::uuid,
    md5('seed-workspace:small-2')::uuid,
    'Default Pipeline'
  ),
  (
    md5('seed-pipeline:small-3')::uuid,
    md5('seed-workspace:small-3')::uuid,
    'Default Pipeline'
  ),
  (
    md5('seed-pipeline:small-4')::uuid,
    md5('seed-workspace:small-4')::uuid,
    'Default Pipeline'
  ),
  (
    md5('seed-pipeline:small-5')::uuid,
    md5('seed-workspace:small-5')::uuid,
    'Default Pipeline'
  )
ON CONFLICT (id) DO NOTHING;

-- seed-step
WITH pipeline_definitions (pipeline_key, workspace_key, stage_names) AS (
  VALUES
    (
      'main',
      'main',
      ARRAY[
        'New Lead',
        'Contacted',
        'Qualified',
        'Discovery',
        'Proposal Sent',
        'Negotiation',
        'Legal Review',
        'Verbal Commit',
        'Closed Won',
        'Closed Lost',
        'Abandoned',
        'On Hold'
      ]::text[]
    ),
    (
      'secondary',
      'main',
      ARRAY['New Lead', 'Qualified', 'Proposal Sent', 'Closed Won']::text[]
    ),
    (
      'small-1',
      'small-1',
      ARRAY['New Lead', 'Contacted', 'Qualified', 'Closed Won']::text[]
    ),
    (
      'small-2',
      'small-2',
      ARRAY['New Lead', 'Contacted', 'Qualified', 'Closed Won']::text[]
    ),
    (
      'small-3',
      'small-3',
      ARRAY['New Lead', 'Contacted', 'Qualified', 'Closed Won']::text[]
    ),
    (
      'small-4',
      'small-4',
      ARRAY['New Lead', 'Contacted', 'Qualified', 'Closed Won']::text[]
    ),
    (
      'small-5',
      'small-5',
      ARRAY['New Lead', 'Contacted', 'Qualified', 'Closed Won']::text[]
    )
)
INSERT INTO stages (id, workspace_id, pipeline_id, name, position)
SELECT
  md5('seed-stage:' || pipeline.pipeline_key || ':' || stage.ordinality::text)::uuid,
  md5('seed-workspace:' || pipeline.workspace_key)::uuid,
  md5('seed-pipeline:' || pipeline.pipeline_key)::uuid,
  stage.name,
  (stage.ordinality - 1)::integer
FROM pipeline_definitions AS pipeline
CROSS JOIN LATERAL
  unnest(pipeline.stage_names) WITH ORDINALITY AS stage(name, ordinality)
ON CONFLICT DO NOTHING;

-- seed-step
WITH pipeline_definitions (
  pipeline_key,
  workspace_key,
  small_count,
  large_count,
  stage_count
) AS (
  VALUES
    ('main', 'main', 100, 500000, 12),
    ('secondary', 'main', 20, 100, 4),
    ('small-1', 'small-1', 25, 3000, 4),
    ('small-2', 'small-2', 25, 3000, 4),
    ('small-3', 'small-3', 25, 3000, 4),
    ('small-4', 'small-4', 25, 3000, 4),
    ('small-5', 'small-5', 25, 3000, 4)
)
INSERT INTO opportunities (
  id,
  workspace_id,
  pipeline_id,
  stage_id,
  name,
  value,
  status,
  owner_id,
  stage_revision,
  created_at,
  updated_at
)
SELECT
  md5(
    'seed-opportunity:'
    || pipeline.workspace_key
    || ':'
    || pipeline.pipeline_key
    || ':'
    || generated.n::text
  )::uuid,
  md5('seed-workspace:' || pipeline.workspace_key)::uuid,
  md5('seed-pipeline:' || pipeline.pipeline_key)::uuid,
  md5(
    'seed-stage:'
    || pipeline.pipeline_key
    || ':'
    || CASE
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 26 THEN '1'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 45 THEN '2'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 59 THEN '3'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 69 THEN '4'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 77 THEN '5'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 83 THEN '6'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 88 THEN '7'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 92 THEN '8'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 95 THEN '9'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 97 THEN '10'
      WHEN pipeline.stage_count = 12 AND mod(generated.n - 1, 100) < 98 THEN '11'
      WHEN pipeline.stage_count = 12 THEN '12'
      ELSE (mod(generated.n - 1, pipeline.stage_count) + 1)::text
    END
  )::uuid,
  'Seed Opportunity ' || generated.n::text,
  ((generated.n * 137) % 100000000)::numeric / 100,
  CASE
    WHEN mod(generated.n, 100) < 75 THEN 'open'
    WHEN mod(generated.n, 100) < 87 THEN 'won'
    WHEN mod(generated.n, 100) < 94 THEN 'lost'
    ELSE 'abandoned'
  END,
  'seed-owner-' || mod(generated.n, 50)::text,
  0,
  TIMESTAMPTZ '2026-11-15 00:00:00+00'
    - mod(generated.n, 548) * INTERVAL '1 day',
  TIMESTAMPTZ '2026-11-15 00:00:00+00'
    - mod(generated.n, 548) * INTERVAL '1 day'
FROM pipeline_definitions AS pipeline
CROSS JOIN LATERAL generate_series(
  1,
  CASE current_setting('opportunity.seed_mode')
    WHEN 'large' THEN pipeline.large_count
    ELSE pipeline.small_count
  END
) AS generated(n)
ON CONFLICT (id) DO NOTHING;

-- seed-step
SELECT
  CASE
    WHEN workspace.id = md5('seed-workspace:main')::uuid THEN 'main'
    ELSE 'small-' || right(workspace.name, 1)
  END AS workspace_key,
  CASE
    WHEN pipeline.id = md5('seed-pipeline:main')::uuid THEN 'main'
    WHEN pipeline.id = md5('seed-pipeline:secondary')::uuid THEN 'secondary'
    ELSE 'small-' || right(workspace.name, 1)
  END AS pipeline_key,
  workspace.id::text AS workspace_id,
  pipeline.id::text AS pipeline_id,
  array_agg(stage.id::text ORDER BY stage.position) AS stage_ids,
  count(DISTINCT opportunity.id)::integer AS opportunity_count
FROM workspaces AS workspace
JOIN pipelines AS pipeline ON pipeline.workspace_id = workspace.id
JOIN stages AS stage
  ON stage.workspace_id = workspace.id
  AND stage.pipeline_id = pipeline.id
LEFT JOIN opportunities AS opportunity
  ON opportunity.workspace_id = workspace.id
  AND opportunity.pipeline_id = pipeline.id
WHERE workspace.id = md5('seed-workspace:main')::uuid
   OR workspace.id IN (
     md5('seed-workspace:small-1')::uuid,
     md5('seed-workspace:small-2')::uuid,
     md5('seed-workspace:small-3')::uuid,
     md5('seed-workspace:small-4')::uuid,
     md5('seed-workspace:small-5')::uuid
   )
GROUP BY workspace.id, workspace.name, pipeline.id
ORDER BY workspace_key, pipeline_key;
