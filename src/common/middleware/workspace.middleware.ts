import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface WorkspaceRequest extends Request {
  workspaceId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkspaceMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const workspaceId = request.header('x-workspace-id');
    if (!workspaceId || !UUID_PATTERN.test(workspaceId)) {
      throw new BadRequestException('X-Workspace-Id must be a UUID');
    }

    (request as WorkspaceRequest).workspaceId = workspaceId.toLowerCase();
    next();
  }
}
