export const UUID_FORMAT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidFormat(value: unknown): value is string {
  return typeof value === 'string' && UUID_FORMAT_PATTERN.test(value);
}

export function uuidFormatError(field: string): string {
  return `${field} must be a UUID in 8-4-4-4-12 hexadecimal format`;
}
