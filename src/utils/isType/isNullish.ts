import { isNull } from '@utils/isType/isNull';
import { isUndefined } from '@utils/isType/isUndefined';

export function isNullish(value: unknown): value is undefined | null {
  return isUndefined(value) || isNull(value);
}
