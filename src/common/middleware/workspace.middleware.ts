import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isUuidFormat, uuidFormatError } from '../validation/uuid';

export interface WorkspaceRequest extends Request {
  workspaceId: string;
}

@Injectable()
export class WorkspaceMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const workspaceId = request.header('x-workspace-id');
    if (!isUuidFormat(workspaceId)) {
      throw new BadRequestException(uuidFormatError('X-Workspace-Id'));
    }

    (request as WorkspaceRequest).workspaceId = workspaceId.toLowerCase();
    next();
  }
}
