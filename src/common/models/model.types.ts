export const OPPORTUNITY_STATUSES = [
  'open',
  'won',
  'lost',
  'abandoned',
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const BULK_MOVE_JOB_STATUSES = [
  'queued',
  'running',
  'retry_wait',
  'completed',
  'failed',
] as const;

export type BulkMoveJobStatus = (typeof BULK_MOVE_JOB_STATUSES)[number];

export const BULK_MOVE_ITEM_OUTCOMES = [
  'pending',
  'moved',
  'skipped_conflict',
  'skipped_already_at_destination',
] as const;

export type BulkMoveItemOutcome = (typeof BULK_MOVE_ITEM_OUTCOMES)[number];
