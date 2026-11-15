import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, Sequelize, col, literal } from 'sequelize';
import { Opportunity } from '../common/models/opportunity.model';
import { Stage } from '../common/models/stage.model';
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from '../common/models/model.types';
import {
  type CreateOpportunityInput,
  type OpportunityPage,
  type OpportunityRecord,
} from './opportunities.types';

interface PageCursor {
  createdAt: string;
  id: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Stage) private readonly stageModel: typeof Stage,
    @InjectModel(Opportunity)
    private readonly opportunityModel: typeof Opportunity,
  ) {}

  async create(
    workspaceId: string | undefined,
    pipelineId: string,
    input: CreateOpportunityInput,
  ): Promise<OpportunityRecord> {
    const tenantId = this.requireUuid(workspaceId, 'X-Workspace-Id');
    const tenantPipelineId = this.requireUuid(pipelineId, 'pipelineId');
    const name = this.requireText(input?.name, 'name', 255);
    const value = this.requireMoney(input?.value);
    const status = this.requireStatus(input?.status);
    const ownerId = this.requireText(input?.ownerId, 'ownerId', 255);
    const stageId = this.requireUuid(input?.stageId, 'stageId');

    return this.sequelize.transaction(async (transaction) => {
      const stage = await this.stageModel.findOne({
        attributes: ['id'],
        where: {
          workspaceId: tenantId,
          pipelineId: tenantPipelineId,
          id: stageId,
        },
        transaction,
      });

      if (!stage) {
        throw new NotFoundException('Pipeline or stage not found in workspace');
      }

      const opportunity = await this.opportunityModel.create(
        {
          workspaceId: tenantId,
          pipelineId: tenantPipelineId,
          stageId,
          name,
          value,
          status,
          ownerId,
        },
        { transaction },
      );

      return this.toRecord(opportunity);
    });
  }

  async listByStage(
    workspaceId: string | undefined,
    pipelineId: string,
    stageId: string | undefined,
    requestedLimit?: string,
    cursorToken?: string,
  ): Promise<OpportunityPage> {
    const tenantId = this.requireUuid(workspaceId, 'X-Workspace-Id');
    const tenantPipelineId = this.requireUuid(pipelineId, 'pipelineId');
    const stage = this.requireUuid(stageId, 'stageId');
    const limit = this.parseLimit(requestedLimit);
    const cursor = this.parseCursor(cursorToken);

    const existingStage = await this.stageModel.findOne({
      attributes: ['id'],
      where: {
        workspaceId: tenantId,
        pipelineId: tenantPipelineId,
        id: stage,
      },
    });

    if (!existingStage) {
      throw new NotFoundException('Pipeline or stage not found in workspace');
    }

    const rows = await this.opportunityModel.findAll({
      attributes: {
        include: [
          [
            literal(
              `to_char("Opportunity"."created_at" AT TIME ZONE 'UTC', '${TIMESTAMP_FORMAT}')`,
            ),
            'cursorCreatedAt',
          ],
        ],
      },
      where: {
        workspaceId: tenantId,
        pipelineId: tenantPipelineId,
        stageId: stage,
        ...(cursor
          ? {
              [Op.and]: [
                literal(
                  `("Opportunity"."created_at", "Opportunity"."id") > ` +
                    `(TIMESTAMPTZ '${cursor.createdAt}', UUID '${cursor.id}')`,
                ),
              ],
            }
          : {}),
      },
      order: [
        [col('Opportunity.created_at'), 'ASC'],
        [col('Opportunity.id'), 'ASC'],
      ],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      data: pageRows.map((row) =>
        this.toRecord(row, this.getCursorTimestamp(row)),
      ),
      nextCursor:
        hasMore && lastRow
          ? this.encodeCursor({
              createdAt: this.getCursorTimestamp(lastRow),
              id: lastRow.id,
            })
          : null,
      limit,
    };
  }

  private requireUuid(value: string | undefined, field: string): string {
    if (!value || !UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return value.toLowerCase();
  }

  private requireText(
    value: unknown,
    field: string,
    maximumLength: number,
  ): string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.length > maximumLength
    ) {
      throw new BadRequestException(
        `${field} must be a non-empty string of at most ${maximumLength} characters`,
      );
    }
    return value.trim();
  }

  private requireMoney(value: unknown): string {
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      !MONEY_PATTERN.test(String(value))
    ) {
      throw new BadRequestException(
        'value must be a decimal with at most 16 integer and 2 fractional digits',
      );
    }
    return String(value);
  }

  private requireStatus(value: unknown): OpportunityStatus {
    if (
      typeof value !== 'string' ||
      !OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)
    ) {
      throw new BadRequestException(
        `status must be one of: ${OPPORTUNITY_STATUSES.join(', ')}`,
      );
    }
    return value as OpportunityStatus;
  }

  private parseLimit(value?: string): number {
    if (value === undefined) {
      return DEFAULT_PAGE_SIZE;
    }
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('limit must be an integer');
    }
    const limit = Number(value);
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new BadRequestException(
        `limit must be between 1 and ${MAX_PAGE_SIZE}`,
      );
    }
    return limit;
  }

  private parseCursor(token?: string): PageCursor | null {
    if (token === undefined) {
      return null;
    }
    if (token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new BadRequestException('cursor is invalid');
    }

    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(token, 'base64url').toString('utf8'),
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('createdAt' in parsed) ||
        !('id' in parsed) ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        !UUID_PATTERN.test(parsed.id) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(
          parsed.createdAt,
        ) ||
        !this.isValidCursorTimestamp(parsed.createdAt)
      ) {
        throw new Error('Invalid cursor payload');
      }
      return { createdAt: parsed.createdAt, id: parsed.id.toLowerCase() };
    } catch {
      throw new BadRequestException('cursor is invalid');
    }
  }

  private encodeCursor(cursor: PageCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private isValidCursorTimestamp(timestamp: string): boolean {
    const millisecondTimestamp = `${timestamp.slice(0, 23)}Z`;
    const parsedDate = new Date(millisecondTimestamp);
    return (
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.toISOString() === millisecondTimestamp
    );
  }

  private getCursorTimestamp(row: Opportunity): string {
    const timestamp = row.get('cursorCreatedAt');
    if (typeof timestamp !== 'string') {
      throw new Error('Opportunity query did not return its cursor timestamp');
    }
    return timestamp;
  }

  private toRecord(
    row: Opportunity,
    createdAt = row.createdAt.toISOString(),
  ): OpportunityRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      pipelineId: row.pipelineId,
      stageId: row.stageId,
      name: row.name,
      value: String(row.value),
      status: row.status,
      ownerId: row.ownerId,
      stageRevision: Number(row.stageRevision),
      createdAt,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
