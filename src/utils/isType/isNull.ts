import { isUndefined } from '@utils/isType/isUndefined';

export function isNull(value: unknown): value is null {
  return !isUndefined(value) && value === null;
}
