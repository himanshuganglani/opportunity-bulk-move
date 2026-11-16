import type {
  BulkMoveJobStatus,
  OpportunityStatus,
} from '../../common/models/model.types';

export interface BulkMoveFilters {
  stageId?: string;
  ownerId?: string;
  status?: OpportunityStatus;
  minValue?: number | string;
  maxValue?: number | string;
  createdFrom?: string;
  createdTo?: string;
}

export interface SubmitBulkMoveInput {
  destinationStageId: string;
  filters?: BulkMoveFilters;
}

export interface BulkMoveSubmission {
  jobId: string;
  status: BulkMoveJobStatus;
}

export interface BulkMoveProgress {
  jobId: string;
  status: BulkMoveJobStatus;
  snapshotCount: number;
  movedCount: number;
  skippedConflictCount: number;
  skippedAlreadyAtDestinationCount: number;
  pendingCount: number;
  heartbeatAt: string | null;
  failureReason: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface NormalizedBulkMoveFilters {
  stageId: string | null;
  ownerId: string | null;
  status: OpportunityStatus | null;
  minValue: string | null;
  maxValue: string | null;
  createdFrom: string | null;
  createdTo: string | null;
}
