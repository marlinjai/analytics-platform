export { murmurhash3 } from './hash.js';
export { assign, evaluateFlag } from './assign.js';
export type {
  ExperimentVariant,
  ExperimentDefinition,
  FlagDefinition,
  RemoteConfig,
} from './types.js';
export {
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  LUMITRA_UID_COOKIE,
  assignAll,
  assignAllFlags,
  encodeVariants,
  decodeVariants,
  encodeVariantsPublic,
  decodeVariantsPublic,
} from './variants.js';
export type {
  VariantAssignments,
  FlagAssignments,
  ExperimentIdMap,
  DecodedAssignments,
  EncodeVariantsOptions,
  DecodeVariantsOptions,
} from './variants.js';
export {
  LUMITRA_VARIANT_OVERRIDE_COOKIE,
  LUMITRA_VARIANT_QUERY_PARAM,
  LUMITRA_VARIANT_CLEAR,
  parseOverrideQuery,
  encodeOverride,
  decodeOverride,
} from './override.js';
export type { VariantOverride } from './override.js';
