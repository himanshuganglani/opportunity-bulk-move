import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Pool } from 'pg';
import { AppLogger } from '../logging/app-logger';
import { POSTGRES_POOL } from '../postgres/postgres.constants';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly logger: AppLogger,
  ) {}

  @Get('live')
  @ApiOperation({
    summary: 'Check process liveness',
    description: 'Returns success when the API process is responsive.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get(['', 'ready'])
  @ApiOperation({
    summary: 'Check API and PostgreSQL readiness',
    description:
      'Checks PostgreSQL connectivity. Available at both /health and /health/ready.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'] },
        dependencies: {
          type: 'object',
          properties: { postgres: { type: 'string', enum: ['up'] } },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'PostgreSQL readiness check failed.',
    schema: {
      example: { status: 'error', dependencies: { postgres: 'down' } },
    },
  })
  async readiness(): Promise<{
    status: 'ok';
    dependencies: { postgres: 'up' };
  }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', dependencies: { postgres: 'up' } };
    } catch (error) {
      this.logger.error(
        'PostgreSQL readiness check failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException({
        status: 'error',
        dependencies: { postgres: 'down' },
      });
    }
  }
}
