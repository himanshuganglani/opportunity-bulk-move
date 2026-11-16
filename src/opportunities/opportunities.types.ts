import type { OpportunityStatus } from '../common/models/model.types';

export { OPPORTUNITY_STATUSES } from '../common/models/model.types';
export type { OpportunityStatus } from '../common/models/model.types';

export interface CreateOpportunityInput {
  name: string;
  value: number | string;
  status: OpportunityStatus;
  ownerId: string;
  stageId: string;
}

export interface MoveOpportunityInput {
  stageId: string;
}

export interface OpportunityRecord {
  id: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  name: string;
  value: string;
  status: OpportunityStatus;
  ownerId: string;
  stageRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityPage {
  data: OpportunityRecord[];
  nextCursor: string | null;
  limit: number;
}
