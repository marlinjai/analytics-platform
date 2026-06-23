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
  DecodedAssignments,
  EncodeVariantsOptions,
  DecodeVariantsOptions,
} from './variants.js';
