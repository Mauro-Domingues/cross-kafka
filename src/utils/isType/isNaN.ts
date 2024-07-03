export function isNaN(value: unknown): value is 'NaN' {
  return Number.isNaN(Number(value));
}
