export function isBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value);
}
