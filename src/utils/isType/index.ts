import { isArray } from '@utils/isType/isArray';
import { isBuffer } from '@utils/isType/isBuffer';
import { isNaN } from '@utils/isType/isNaN';
import { isNull } from '@utils/isType/isNull';
import { isNullish } from '@utils/isType/isNullish';
import { isNumber } from '@utils/isType/isNumber';
import { isObject } from '@utils/isType/isObject';
import { isPlainObject } from '@utils/isType/isPlainObject';
import { isString } from '@utils/isType/isString';
import { isUndefined } from '@utils/isType/isUndefined';

export const isType = {
  undefined: isUndefined,
  null: isNull,
  nullish: isNullish,
  object: isObject,
  string: isString,
  number: isNumber,
  plainObject: isPlainObject,
  array: isArray,
  buffer: isBuffer,
  NaN: isNaN,
};
