import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { isUuidFormat, uuidFormatError } from '../validation/uuid';

@Injectable()
export class UuidFormatPipe implements PipeTransform<unknown, string> {
  constructor(private readonly field: string) {}

  transform(value: unknown): string {
    if (!isUuidFormat(value)) {
      throw new BadRequestException(uuidFormatError(this.field));
    }
    return value;
  }
}
