// Public entry point: createBlub plus the vocabulary, commands and schema.
export { createBlub } from './blub.js';
export { defineMoment } from './sdk/moments.js';
export type { Blub, BlubOptions } from './blub.js';
export {
  SHAPES,
  FACES,
  COLORS,
  ACTIONS,
  STATUSES,
  commandSchema,
} from './sdk/commands.js';
export type { ClayOptions, ClaySettings } from './sdk/clay.js';
export type {
  MomentBeat,
  MomentBuilder,
  MomentCommand,
  MomentCue,
  MomentDefinition,
  MomentLook,
  MomentParams,
  MomentResult,
  MomentRunOptions,
} from './sdk/moments.js';
export type {
  Action,
  BlubCommand,
  BlubEvents,
  BlubLookTarget,
  BlubSetOptions,
  BlubState,
  Color,
  Face,
  Finish,
  FollowCommandEntry,
  FollowCommandTarget,
  FollowContext,
  FollowElementTarget,
  FollowEntry,
  FollowEntryInput,
  FollowEntryOptions,
  FollowOptions,
  FollowPointerFacts,
  FollowPointerOptions,
  FollowPoint,
  FollowRange,
  FollowSpec,
  FollowTarget,
  PlayResult,
  PlayStatus,
  Shape,
  Status,
} from './sdk/commands.js';

export { ACCESSORY_NAMES } from './sdk/accessories.js';
export type { Accessory, AccessoryInput } from './sdk/accessories.js';
