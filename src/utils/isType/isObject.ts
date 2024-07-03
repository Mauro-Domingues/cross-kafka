import { isNullish } from '@utils/isType/isNullish';

export function isObject(value: unknown): value is object {
  return !isNullish(value) && typeof value === 'object';
}
